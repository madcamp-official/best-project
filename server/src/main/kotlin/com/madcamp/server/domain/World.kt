package com.madcamp.server.domain

import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.HolderIds
import com.madcamp.server.data.BoundaryCell

/**
 * web/src/game/core.ts `GameState` 1:1 대응 (plan.md §4). React 밖 상태였던 것처럼
 * 여기서는 [com.madcamp.server.loop.GameLoop]의 단일 스레드에서만 mutate된다 —
 * 그래서 동시성 제어(락)가 없다. 다른 스레드는 GameLoop.runOnLoop{}를 통해서만 접근한다.
 */
class World(
    val n: Int,
    val ownerId: IntArray,
    val troops: IntArray,
    val troopAccum: DoubleArray,
    val troopCap: IntArray,
    val neighborIndex: Array<IntArray>,
    val meta: Array<DongStaticMeta>,
    val borderMask: BooleanArray, // 지도 바깥에 닿는 동(0/1, 정적) — 포위 귀속 판정용
    // 셀별 대략적 반지름(경위도 도, 정적) — 미사일/전술핵 명중 판정 보정용(MissileController 등 참조).
    val radiusDeg: DoubleArray,
) {
    val holders: LinkedHashMap<Int, Holder> = LinkedHashMap()
    val orders: MutableList<Order> = mutableListOf() // 이동 중인 유닛(원)
    val dirty: MutableSet<Int> = HashSet()
    val missile: BooleanArray = BooleanArray(n) // 동별 미사일 보유 여부(동에 종속 — 그 동 소유자가 발사)

    // 공격 큐: holderId → 공격 대상 admIndex 집합. 매 주기 각 대상에 인접한 내 동들이 자동 출정하고,
    // 후방 병력은 tickSupply가 가장 가까운 대상(전선)으로 자동 전진시킨다(예전 집결지(rally) 대체).
    // web/src/game/core.ts GameState.attackQueue 대응.
    val attackQueue: Array<MutableSet<Int>> = Array(256) { HashSet() }

    // 공수부대(B3): holderId → 재사용 가능해지는 벽시계 시각(ms). 0=쿨타임 없음. 크기 256.
    // web/src/game/core.ts GameState.airdropReadyAt 대응.
    val airdropReadyAt: LongArray = LongArray(256)

    // 스폰 방어막: holderId → 보호 종료 벽시계 시각(ms). 0=방어막 없음. 크기 256.
    // 신규 참가·재시작 시 SPAWN_SHIELD_SEC 뒤로 설정된다(GameCore.applyShield).
    val shieldUntil: LongArray = LongArray(256)

    // 시도(sido)별 admIndex 목록 — 미사일 스폰을 지역 균등(시도 먼저 균등 추첨)으로 뽑을 때 쓴다.
    // 동 개수가 시도별로 크게 달라서(서울·부산은 동이 촘촘히 쪼개져 있음) 동 단위로 그냥
    // 균등 추첨하면 그쪽에 쏠린다(GameCore.trySpawnMissile 참조). World 생성 시 1회 계산.
    val cellsBySido: List<IntArray> = (0 until n).groupBy { meta[it].sidocd }.values.map { it.toIntArray() }

    // 포위 귀속(GameCore.tickAnnex): 이 동을 현재 포위 중인 holderId(-1=없음)와, 그 연속 포위가
    // 시작된 시각(ms). ANNEX_HOLD_SEC 유지 판정용 — web/src/game/core.ts enclosedBy/enclosedSince 대응.
    val enclosedBy: IntArray = IntArray(n) { -1 }
    val enclosedSince: LongArray = LongArray(n)

    // 전술핵 사일로(web/src/game/core.ts nukeSilos/nukeReadyAt/nukeIslandMask 대응).
    // create()가 config.nukeSiloCodes에서 계산해 채운다. nukeSilos[k] = -1 이면 데이터에 없는 코드.
    var nukeSilos: IntArray = IntArray(0)
    var nukeReadyAt: LongArray = LongArray(0) // 사일로별 재발사 가능 벽시계 시각(ms). 0=즉시 가능.
    var nukeIslandMask: BooleanArray = BooleanArray(n) // 사일로 섬(울릉도·제주 본섬) 소속 동 — 공수 사거리 예외
    var nukeDirty: Boolean = false // 이번 tick 구간에 사일로 쿨다운이 바뀜(발사) → DELTA에 실어 보낸다

    // 이번 tick 구간에 발생한 것 — DELTA 브로드캐스트 후 비운다(api-spec.md §2.5).
    val pendingNewOrders: MutableList<Order> = mutableListOf()
    val pendingEvents: MutableList<LogEvent> = mutableListOf()
    val pendingMissileAdd: MutableList<Int> = mutableListOf()
    val pendingMissileRemove: MutableList<Int> = mutableListOf()
    val pendingMissileImpacts: MutableList<Int> = mutableListOf() // 이번 구간 미사일 착탄 동(폭발 연출용)
    val pendingNewHolders: MutableList<Holder> = mutableListOf() // 신규 참가자 holder (색상 동기화용)
    val pendingShields: MutableList<ShieldInfo> = mutableListOf() // 새로 생기거나 갱신된 방어막
    val pendingRemovedOrders: MutableList<Int> = mutableListOf() // 이번 tick에 제거된 유닛 id(미사일 타격)

    var nextHolderId: Int = 1 // 0=중립, 255=E 예약이므로 1부터. 254 도달 시 순환(HolderIdAllocator).
    var nextLogId: Int = 1
    var nextOrderId: Int = 1 // 이동 유닛(order) 고유 id 발급 카운터(미사일 타격 등으로 제거 시 지목용).
    var envLastActMs: Long = 0L

    /** 1..254 순환 할당(0 중립·255 E 예약). 이미 쓰는 id는 건너뛴다. 254개 다 차면 예외.
     *  사람 참가(SessionService)와 AI 채우기(PlayerAi)가 같은 할당기를 공유한다. */
    fun allocateHolderId(): Int {
        var candidate = nextHolderId
        repeat(254) {
            if (candidate !in holders) {
                nextHolderId = if (candidate >= 254) 1 else candidate + 1
                return candidate
            }
            candidate = if (candidate >= 254) 1 else candidate + 1
        }
        error("holderId 254개가 모두 사용 중입니다.")
    }

    companion object {
        /** README §3.4 — pop 데이터 미보유 시 fallback: 전 동 troopCap = baseCap 균일. */
        fun create(cells: List<BoundaryCell>, config: GameConfig): World {
            val n = cells.size
            val ownerId = IntArray(n) { HolderIds.NEUTRAL }
            val troops = IntArray(n) { config.neutralTroops }
            val troopAccum = DoubleArray(n)
            val troopCap = IntArray(n) { config.baseCap }
            val neighborIndex = Array(n) { cells[it].neighbors.toIntArray() }
            val meta = Array(n) {
                val c = cells[it]
                DongStaticMeta(c.admIndex, c.code, c.name, c.sggcd, c.sggnm, c.sidocd, c.sidonm, c.centroid)
            }
            val borderMask = BooleanArray(n) { cells[it].border }
            val radiusDeg = DoubleArray(n) { cells[it].radiusDeg }
            val world = World(n, ownerId, troops, troopAccum, troopCap, neighborIndex, meta, borderMask, radiusDeg)
            world.holders[HolderIds.NEUTRAL] = Holder(HolderIds.NEUTRAL, "중립", 0)
            initNukeState(world, config)
            return world
        }

        /**
         * 전술핵 사일로 상태 초기화(web/src/game/core.ts initNukeState 대응) — 정적 데이터에서 파생.
         * 사일로 동에서 인접 그래프를 flood한 연결요소 전체가 "사일로 섬"(울릉도·제주 본섬)이 되고,
         * 이 섬을 오가는 공수는 사거리 제한을 받지 않는다(GameCore.tryAirdrop).
         */
        private fun initNukeState(world: World, config: GameConfig) {
            val codeToIdx = HashMap<String, Int>(world.n * 2)
            for (i in 0 until world.n) codeToIdx[world.meta[i].code] = i
            world.nukeSilos = IntArray(config.nukeSiloCodes.size) { codeToIdx[config.nukeSiloCodes[it]] ?: -1 }
            world.nukeReadyAt = LongArray(world.nukeSilos.size)
            world.nukeIslandMask = BooleanArray(world.n)
            for (silo in world.nukeSilos) {
                if (silo < 0 || world.nukeIslandMask[silo]) continue
                val stack = ArrayDeque<Int>()
                stack.addLast(silo)
                world.nukeIslandMask[silo] = true
                while (stack.isNotEmpty()) {
                    val cur = stack.removeLast()
                    for (nb in world.neighborIndex[cur]) {
                        if (!world.nukeIslandMask[nb]) {
                            world.nukeIslandMask[nb] = true
                            stack.addLast(nb)
                        }
                    }
                }
            }
        }
    }
}
