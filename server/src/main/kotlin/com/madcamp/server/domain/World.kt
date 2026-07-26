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
) {
    val holders: LinkedHashMap<Int, Holder> = LinkedHashMap()
    val orders: MutableList<Order> = mutableListOf() // 이동 중인 유닛(원)
    val dirty: MutableSet<Int> = HashSet()
    val missile: BooleanArray = BooleanArray(n) // 동별 미사일 보유 여부(동에 종속 — 그 동 소유자가 발사)

    // 보급선(B2): holderId → 집결지 admIndex(-1=없음). 크기 256 = holderId 예약 범위(0 중립 … 255 E).
    // web/src/game/core.ts GameState.rally 대응.
    val rally: IntArray = IntArray(256) { -1 }

    // 시도(sido)별 admIndex 목록 — 미사일 스폰을 지역 균등(시도 먼저 균등 추첨)으로 뽑을 때 쓴다.
    // 동 개수가 시도별로 크게 달라서(서울·부산은 동이 촘촘히 쪼개져 있음) 동 단위로 그냥
    // 균등 추첨하면 그쪽에 쏠린다(GameCore.trySpawnMissile 참조). World 생성 시 1회 계산.
    val cellsBySido: List<IntArray> = (0 until n).groupBy { meta[it].sidocd }.values.map { it.toIntArray() }

    // 포위 귀속(GameCore.tickAnnex): 이 동을 현재 포위 중인 holderId(-1=없음)와, 그 연속 포위가
    // 시작된 시각(ms). ANNEX_HOLD_SEC 유지 판정용 — web/src/game/core.ts enclosedBy/enclosedSince 대응.
    val enclosedBy: IntArray = IntArray(n) { -1 }
    val enclosedSince: LongArray = LongArray(n)

    // 이번 tick 구간에 발생한 것 — DELTA 브로드캐스트 후 비운다(api-spec.md §2.5).
    val pendingNewOrders: MutableList<Order> = mutableListOf()
    val pendingEvents: MutableList<LogEvent> = mutableListOf()
    val pendingMissileAdd: MutableList<Int> = mutableListOf()
    val pendingMissileRemove: MutableList<Int> = mutableListOf()
    val pendingNewHolders: MutableList<Holder> = mutableListOf() // 신규 참가자 holder (색상 동기화용)

    var nextHolderId: Int = 1 // 0=중립, 255=E 예약이므로 1부터. 254 도달 시 순환(HolderIdAllocator).
    var nextLogId: Int = 1
    var envLastActMs: Long = 0L

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
            val world = World(n, ownerId, troops, troopAccum, troopCap, neighborIndex, meta, borderMask)
            world.holders[HolderIds.NEUTRAL] = Holder(HolderIds.NEUTRAL, "중립", 0)
            return world
        }
    }
}
