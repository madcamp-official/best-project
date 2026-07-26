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
    fun trySortie(world: World, config: GameConfig, from: Int, to: Int, holderId: Int, nowMs: Long): SortieResult {
        if (world.ownerId[from] != holderId) {
            return SortieResult.Err(SortieErrorCode.NOT_OWNER, "본인 소유 동이 아닙니다.")
        }
        if (to !in world.neighborIndex[from]) {
            return SortieResult.Err(SortieErrorCode.NOT_ADJACENT, "인접한 동이 아닙니다.")
        }
        val amount = floor(world.troops[from] * config.sortieRatio).toInt()
        if (amount <= 0) {
            return SortieResult.Err(SortieErrorCode.NO_TROOPS, "출정 가능한 병력이 없습니다.")
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
                if (prevOwner == HolderIds.ENV && holderId != HolderIds.ENV) {
                    settled = min(world.troopCap[to], settled + config.envBounty)
                }
                world.troops[to] = settled
                pushLog(world, "${world.meta[to].name} 함락 — ${prevHolder?.name ?: "?"} → ${nextHolder?.name ?: "?"}", wallNowMs)
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
