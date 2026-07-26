package com.madcamp.server.domain

import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.HolderIds
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sqrt

/**
 * web/src/game/core.ts 1:1 이식 (plan.md §4 "서버 담당이 Kotlin으로 이식할 때 1:1 대조 자료").
 * 순수 함수만 둔다 — World를 인자로 받고 시간은 호출자가 주입한다(core.ts와 동일 원칙).
 * 단, 이 서버에서는 [com.madcamp.server.loop.GameLoop]가 유일한 호출자이며 항상 같은
 * 스레드에서만 부르므로 동시성 걱정 없이 World를 직접 mutate한다.
 */
object GameCore {

    // README §4.1 — 접속 여부와 무관하게 모든 non-중립 holder의 동을 생산한다.
    // (README §4.1의 "접속 중인 소유자만 생산"은 오프라인 단일 플레이어 목업 한정 규칙이었고,
    //  온라인 다인 데모에서 접속 상태 추적까지 만들 이유가 없어 항상 생산으로 단순화한다.)
    fun tickProduction(world: World, config: GameConfig, dtSec: Double) {
        for (i in 0 until world.n) {
            if (world.ownerId[i] == HolderIds.NEUTRAL) continue
            if (world.troops[i] >= world.troopCap[i]) continue

            val mult = if (world.ownerId[i] == HolderIds.ENV) config.envProdMult else 1.0
            world.troopAccum[i] += dtSec * world.troopCap[i] / config.fillToCapSec * mult
            val inc = floor(world.troopAccum[i]).toInt()
            if (inc <= 0) continue

            world.troopAccum[i] -= inc
            val next = min(world.troopCap[i], world.troops[i] + inc)
            if (next != world.troops[i]) {
                world.troops[i] = next
                world.dirty.add(i)
            }
        }
    }

    // README §4.2, §4.4 — 출정. 병력은 출발과 동시에 출발지를 떠나고, 전투/증원은
    // 유닛이 도착(arriveTick)할 때 resolveArrival에서 처리한다.
    // ratio: web/src/game/core.ts trySortie와 동일하게 신뢰된 값으로 받는다 — 클라 입력
    // 클램프는 여기(순수 코어)가 아니라 호출자(SortieController)의 책임이다.
    fun trySortie(
        world: World,
        config: GameConfig,
        from: Int,
        to: Int,
        holderId: Int,
        nowMs: Long,
        ratio: Double = config.sortieRatio,
    ): SortieResult {
        if (world.ownerId[from] != holderId) {
            return SortieResult.Err(SortieErrorCode.NOT_OWNER, "본인 소유 동이 아닙니다.")
        }
        if (to !in world.neighborIndex[from]) {
            return SortieResult.Err(SortieErrorCode.NOT_ADJACENT, "인접한 동이 아닙니다.")
        }
        var amount = floor(world.troops[from] * ratio).toInt()
        if (amount <= 0) {
            return SortieResult.Err(SortieErrorCode.NO_TROOPS, "출정 가능한 병력이 없습니다.")
        }
        // 목적지가 내 동(증원)이면 상한 여유분만큼만 보낸다 — 초과분이 상한에 막혀 소멸하는 것을 방지.
        // 여유가 전혀 없으면(이미 가득) 보낼 게 없으므로 거부한다.
        if (world.ownerId[to] == holderId) {
            val headroom = world.troopCap[to] - world.troops[to]
            if (headroom <= 0) {
                return SortieResult.Err(SortieErrorCode.ALREADY_FULL, "이미 병력이 가득 찬 동입니다.")
            }
            if (amount > headroom) amount = headroom
        }

        world.troops[from] -= amount
        world.dirty.add(from)

        val travelSec = (centroidDistance(world, from, to) / config.unitSpeedDegPerSec)
            .coerceIn(config.unitTravelMinSec, config.unitTravelMaxSec)
        val order = Order(
            from = from,
            to = to,
            amount = amount,
            holderId = holderId,
            departTick = nowMs,
            arriveTick = nowMs + (travelSec * 1000).toLong(),
        )
        world.orders.add(order)
        world.pendingNewOrders.add(order)
        return SortieResult.Ok
    }

    // 매 tick 호출 — 도착한 유닛을 처리하고 목록에서 제거.
    fun tickOrders(world: World, config: GameConfig, nowMs: Long) {
        val it = world.orders.iterator()
        while (it.hasNext()) {
            val order = it.next()
            if (nowMs >= order.arriveTick) {
                resolveArrival(world, config, order, nowMs)
                it.remove()
            }
        }
    }

    // README §4.3 — 전투 판정. §4.6 토벌 보너스(ENV_BOUNTY)도 여기서 함께 처리한다.
    private fun resolveArrival(world: World, config: GameConfig, order: Order, wallNowMs: Long) {
        val to = order.to
        val amount = order.amount
        val holderId = order.holderId

        if (world.ownerId[to] == holderId) {
            world.troops[to] = min(world.troopCap[to], world.troops[to] + amount)
        } else {
            val prevOwner = world.ownerId[to]
            val remaining = world.troops[to] - amount
            if (remaining < 0) {
                val prevHolder = world.holders[prevOwner]
                val nextHolder = world.holders[holderId]
                world.ownerId[to] = holderId
                var settled = -remaining
                // README §4.6 토벌 보상 — web/src/game/core.ts resolveArrival과 동일 조건/문구.
                val playerBeatEnv = prevOwner == HolderIds.ENV && holderId != HolderIds.ENV && holderId != HolderIds.NEUTRAL
                if (playerBeatEnv) settled = min(world.troopCap[to], settled + config.envBounty)
                world.troops[to] = settled
                val bountySuffix = if (playerBeatEnv) " (+${config.envBounty} 토벌)" else ""
                pushLog(
                    world,
                    "${world.meta[to].name} 함락 — ${prevHolder?.name ?: "?"} → ${nextHolder?.name ?: "?"}$bountySuffix",
                    wallNowMs,
                )
            } else {
                world.troops[to] = remaining
            }
        }
        world.dirty.add(to)
    }

    private fun centroidDistance(world: World, from: Int, to: Int): Double {
        val a = world.meta[from].centroid
        val b = world.meta[to].centroid
        val dx = a[0] - b[0]
        val dy = a[1] - b[1]
        return sqrt(dx * dx + dy * dy)
    }

    fun drainDirty(world: World): List<Int> {
        if (world.dirty.isEmpty()) return emptyList()
        val list = world.dirty.toList()
        world.dirty.clear()
        return list
    }

    // ── 미사일 (web/src/game/core.ts 대응) ──────────────────────────────
    // 동에 종속: 미사일은 특정 동 위에 얹혀 있고, 그 동을 소유한 홀더가 발사할 수 있다.

    fun missileCount(world: World, holderId: Int): Int {
        var c = 0
        for (i in 0 until world.n) if (world.ownerId[i] == holderId && world.missile[i]) c++
        return c
    }

    // 맵 전체에 존재하는 미사일 총 수(소유·중립 무관).
    fun totalMissileCount(world: World): Int {
        var c = 0
        for (i in 0 until world.n) if (world.missile[i]) c++
        return c
    }

    // 무작위 동 1곳에 미사일 스폰. 맵 전체 총량이 상한이면 스폰하지 않고, 이미 있으면 건너뛰고,
    // 소유주가 플레이어이면서 개인 상한이면 스폰하지 않는다. 반환 = 스폰된 admIndex, 없으면 -1.
    fun trySpawnMissile(world: World, config: GameConfig, rng: java.util.Random): Int {
        if (world.n == 0) return -1
        if (totalMissileCount(world) >= config.missileMaxTotal) return -1 // 맵 전체 상한
        val start = rng.nextInt(world.n)
        for (k in 0 until world.n) {
            val i = (start + k) % world.n
            if (world.missile[i]) continue
            val owner = world.ownerId[i]
            if (owner != HolderIds.NEUTRAL && owner != HolderIds.ENV &&
                missileCount(world, owner) >= config.missileMaxPerPlayer
            ) {
                continue
            }
            world.missile[i] = true
            return i
        }
        return -1
    }

    // 미사일 발사: 내 소유 동에 얹힌 미사일 1개를 소모하고, hits 동을 중립화(병력 0)한다.
    // hits는 호출자(MissileController)가 반경/근접 검증까지 마친 목록이라고 가정한다.
    fun launchMissile(world: World, holderId: Int, hits: List<Int>, wallNowMs: Long): MissileLaunch {
        var src = -1
        for (i in 0 until world.n) {
            if (world.ownerId[i] == holderId && world.missile[i]) {
                src = i
                break
            }
        }
        if (src < 0) return MissileLaunch(ok = false, reason = "발사할 미사일이 없습니다.")

        world.missile[src] = false // 소모

        val neutralized = ArrayList<Int>()
        for (h in hits) {
            if (h < 0 || h >= world.n) continue
            world.ownerId[h] = HolderIds.NEUTRAL
            world.troops[h] = 0
            world.troopAccum[h] = 0.0
            world.dirty.add(h)
            neutralized.add(h)
        }
        pushLog(world, "미사일 착탄 — ${neutralized.size}개 동 중립화", wallNowMs)
        return MissileLaunch(ok = true, removed = src, neutralized = neutralized)
    }

    fun pushLog(world: World, message: String, ts: Long) {
        val event = LogEvent(world.nextLogId++, ts, message)
        world.pendingEvents.add(event)
    }

    fun ownedCount(world: World, holderId: Int): Int {
        var c = 0
        for (i in 0 until world.n) if (world.ownerId[i] == holderId) c++
        return c
    }

    fun ownedIndices(world: World, holderId: Int): List<Int> {
        val list = ArrayList<Int>()
        for (i in 0 until world.n) if (world.ownerId[i] == holderId) list.add(i)
        return list
    }

    // README §8 — E는 순위표에서 제외.
    fun getLeaderboard(world: World): List<LeaderboardRow> =
        world.holders.values
            .filter { it.id != HolderIds.NEUTRAL && it.id != HolderIds.ENV }
            .map { LeaderboardRow(it.id, it.name, ownedCount(world, it.id)) }
            .sortedByDescending { it.count }

    // README §6 — 계급은 저장하지 않고 소유권에서 매번 파생.
    fun computeRank(world: World, holderId: Int): Rank? {
        if (holderId == HolderIds.NEUTRAL || world.n == 0) return null

        val sggTotal = HashMap<String, Int>()
        val sggOwned = HashMap<String, Int>()
        var anyOwned = false

        for (i in 0 until world.n) {
            val sgg = world.meta[i].sggcd
            sggTotal[sgg] = (sggTotal[sgg] ?: 0) + 1
            if (world.ownerId[i] == holderId) {
                anyOwned = true
                sggOwned[sgg] = (sggOwned[sgg] ?: 0) + 1
            }
        }
        if (!anyOwned) return null

        var fullSgg = 0
        for ((sgg, total) in sggTotal) {
            if ((sggOwned[sgg] ?: 0) == total) fullSgg++
        }
        return when {
            fullSgg == 0 -> Rank.DONGJANG
            fullSgg == sggTotal.size -> Rank.DOJISA
            else -> Rank.SIJANG
        }
    }
}
