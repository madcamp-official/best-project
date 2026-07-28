package com.madcamp.server.domain

import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.HolderIds
import kotlin.math.ceil
import kotlin.math.cos
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
            val owner = world.ownerId[i]
            if (owner == HolderIds.NEUTRAL) continue
            if (world.troops[i] >= world.troopCap[i]) continue

            // 생산 배율: E(구 야만인)는 envProdMult, AI 플레이어는 aiProdMult(사람의 80%), 사람은 1.0.
            val mult = when {
                owner == HolderIds.ENV -> config.envProdMult
                world.holders[owner]?.isAi == true -> config.aiProdMult
                else -> 1.0
            }
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

        val order = makeOrder(world, config, from, to, amount, holderId, nowMs)
        world.orders.add(order)
        world.pendingNewOrders.add(order)
        return SortieResult.Ok
    }

    // 드래그 쓸기 — 한 출발지(from)에서 여러 인접 목표(targets)로 병력을 균등 분할해 동시 출정한다.
    // 출정 병력(troops*ratio)을 유효 목표 수로 나눠 목표마다 같은 몫을 보낸다(증원 목표는 상한 여유로 제한).
    // web/src/game/core.ts tryMultiSortie 대응. 각 order는 단일 홉이며 pendingNewOrders로 DELTA에 실린다.
    fun tryMultiSortie(
        world: World,
        config: GameConfig,
        from: Int,
        targets: List<Int>,
        holderId: Int,
        nowMs: Long,
        ratio: Double = config.sortieRatio,
    ): SortieResult {
        if (world.ownerId[from] != holderId) {
            return SortieResult.Err(SortieErrorCode.NOT_OWNER, "본인 소유 동이 아닙니다.")
        }
        val seen = HashSet<Int>()
        val valid = ArrayList<Int>()
        for (t in targets) {
            if (t == from || t < 0 || t >= world.n || !seen.add(t)) continue
            if (t !in world.neighborIndex[from]) continue
            valid.add(t)
        }
        if (valid.isEmpty()) return SortieResult.Err(SortieErrorCode.NOT_ADJACENT, "인접한 목표가 없습니다.")

        val total = floor(world.troops[from] * ratio).toInt()
        if (total <= 0) return SortieResult.Err(SortieErrorCode.NO_TROOPS, "출정 가능한 병력이 없습니다.")
        val share = total / valid.size
        if (share <= 0) return SortieResult.Err(SortieErrorCode.NO_TROOPS, "목표가 너무 많아 나눌 병력이 부족합니다.")

        var anySent = false
        for (t in valid) {
            var amt = share
            if (world.ownerId[t] == holderId) {
                val headroom = world.troopCap[t] - world.troops[t]
                if (headroom <= 0) continue
                if (amt > headroom) amt = headroom
            }
            if (amt <= 0) continue
            world.troops[from] -= amt
            val order = makeOrder(world, config, from, t, amt, holderId, nowMs)
            world.orders.add(order)
            world.pendingNewOrders.add(order)
            anySent = true
        }
        if (!anySent) return SortieResult.Err(SortieErrorCode.NO_TROOPS, "보낼 병력이 없습니다.")
        world.dirty.add(from)
        return SortieResult.Ok
    }

    // 이동 유닛(order) 하나를 만든다. path가 있으면 경로 자동 출정(B1)의 릴레이 컬럼이 된다.
    private fun makeOrder(
        world: World,
        config: GameConfig,
        from: Int,
        to: Int,
        amount: Int,
        holderId: Int,
        nowMs: Long,
        path: List<Int> = emptyList(),
        speedDegPerSec: Double = config.unitSpeedDegPerSec,
        maxSec: Double = config.unitTravelMaxSec,
    ): Order {
        val travelSec = (centroidDistance(world, from, to) / speedDegPerSec)
            .coerceIn(config.unitTravelMinSec, maxSec)
        return Order(world.nextOrderId++, from, to, amount, holderId, nowMs, nowMs + (travelSec * 1000).toLong(), path)
    }

    // 미사일/전술핵이 친 동(cells) 위를 지나는 이동 유닛을 전부 제거한다 — from 또는 to가 타격 동이면
    // 그 유닛은 타격 영토를 밟고 있는 것으로 보고 소멸시킨다. 반환 = 제거된 order id(호출자가 DELTA로 전파).
    // web/src/game/core.ts destroyOrdersOnCells 1:1 대응.
    fun destroyOrdersOnCells(world: World, cells: Collection<Int>): List<Int> {
        if (cells.isEmpty() || world.orders.isEmpty()) return emptyList()
        val hit = cells.toHashSet()
        val removed = ArrayList<Int>()
        val it = world.orders.iterator()
        while (it.hasNext()) {
            val o = it.next()
            if (o.from in hit || o.to in hit) {
                removed.add(o.id)
                it.remove()
            }
        }
        return removed
    }

    // 같은 통로 정면충돌 — A→B와 B→A(같은 변, 반대 방향, 다른 소유주)가 서로를 지나친 순간 중간에서
    // 클래시한다: 작은 쪽 소멸, 큰 쪽은 차액으로 계속(같으면 둘 다 소멸). GameLoop이 매 tick 호출한다.
    // 제거·병력변경 유닛은 world.pendingRemovedOrders/pendingUpdatedOrders로 실려 DELTA로 전파된다.
    // web/src/game/core.ts tickOrderClashes 1:1 대응.
    fun tickOrderClashes(world: World, nowMs: Long) {
        if (world.orders.size < 2) return
        // 방향별 변 인덱스: from→to 방향으로 이동 중인 order들. 키 = from*n+to(고유).
        val byEdge = HashMap<Long, ArrayList<Order>>()
        for (o in world.orders) {
            if (nowMs >= o.arriveTick) continue // 곧 도착(tickOrders가 처리) — 충돌 대상 아님
            byEdge.getOrPut(edgeKey(world, o.from, o.to)) { ArrayList() }.add(o)
        }
        val consumed = HashSet<Int>()
        for (o1 in world.orders) {
            if (o1.id in consumed || nowMs >= o1.arriveTick) continue
            val opp = byEdge[edgeKey(world, o1.to, o1.from)] ?: continue // 반대 방향(같은 변)
            for (o2 in opp) {
                if (o1.id in consumed) break
                if (o2.id in consumed || o2.holderId == o1.holderId) continue // 아군끼리는 통과
                if (clashProgress(o1, nowMs) + clashProgress(o2, nowMs) < 1.0) continue // 아직 서로를 안 지나침
                if (o1.amount > o2.amount) {
                    o1.amount -= o2.amount
                    world.pendingUpdatedOrders.add(OrderAmount(o1.id, o1.amount))
                    consumed.add(o2.id)
                    world.pendingRemovedOrders.add(o2.id)
                } else if (o2.amount > o1.amount) {
                    o2.amount -= o1.amount
                    world.pendingUpdatedOrders.add(OrderAmount(o2.id, o2.amount))
                    consumed.add(o1.id)
                    world.pendingRemovedOrders.add(o1.id)
                } else {
                    consumed.add(o1.id)
                    consumed.add(o2.id)
                    world.pendingRemovedOrders.add(o1.id)
                    world.pendingRemovedOrders.add(o2.id)
                }
            }
        }
        if (consumed.isNotEmpty()) world.orders.removeAll { it.id in consumed }
    }

    private fun edgeKey(world: World, from: Int, to: Int): Long = from.toLong() * world.n + to

    // 유닛의 현재 진행도(0~1) — departTick→arriveTick 선형(web/src/game/core.ts tickOrderClashes progress 대응).
    private fun clashProgress(o: Order, nowMs: Long): Double {
        val span = o.arriveTick - o.departTick
        return if (span > 0) ((nowMs - o.departTick).toDouble() / span).coerceIn(0.0, 1.0) else 1.0
    }

    // B1 — 경로 자동 출정. 멀리 있는 내 동(finalTarget)까지 내 영토만 밟는 최단 경로를 찾아,
    // 출발지 병력을 빼고 그 경로를 통째로 지고 가는 릴레이 컬럼 1개를 띄운다. web/src/game/core.ts tryMarch 대응.
    fun tryMarch(
        world: World,
        config: GameConfig,
        from: Int,
        finalTarget: Int,
        holderId: Int,
        nowMs: Long,
        ratio: Double = config.sortieRatio,
    ): SortieResult {
        if (world.ownerId[from] != holderId) {
            return SortieResult.Err(SortieErrorCode.NOT_OWNER, "본인 소유 동이 아닙니다.")
        }
        if (from == finalTarget) {
            return SortieResult.Err(SortieErrorCode.NO_PATH, "같은 동입니다.")
        }
        if (world.ownerId[finalTarget] != holderId) {
            return SortieResult.Err(SortieErrorCode.NO_PATH, "내 소유 동으로만 자동 행군할 수 있습니다.")
        }
        val nodes = ownedPath(world, from, finalTarget, holderId, config.marchMaxHops)
        if (nodes == null || nodes.size < 2) {
            return SortieResult.Err(SortieErrorCode.NO_PATH, "연결된 내 영토 경로가 없습니다.")
        }
        val amount = floor(world.troops[from] * ratio).toInt()
        if (amount <= 0) {
            return SortieResult.Err(SortieErrorCode.NO_TROOPS, "출정 가능한 병력이 없습니다.")
        }
        world.troops[from] -= amount
        world.dirty.add(from)

        // nodes = [from, h1, ..., finalTarget]. 첫 leg = from→h1, 남은 경로 = [h2..finalTarget].
        val order = makeOrder(world, config, from, nodes[1], amount, holderId, nowMs, nodes.subList(2, nodes.size).toList())
        world.orders.add(order)
        world.pendingNewOrders.add(order)
        return SortieResult.Ok
    }

    // from→to를 잇는 최단 경로를 BFS로 찾되, 통과 가능한 동은 holderId 소유 동만이다(내 영토 릴레이).
    // 반환 = [from, ..., to], 도달 불가면 null. maxHops를 넘는 깊이는 탐색하지 않는다.
    private fun ownedPath(world: World, from: Int, to: Int, holderId: Int, maxHops: Int): List<Int>? {
        val prev = IntArray(world.n) { -2 } // -2=미방문, -1=출발지
        val dist = IntArray(world.n)
        prev[from] = -1
        val q = ArrayList<Int>()
        q.add(from)
        var h = 0
        while (h < q.size) {
            val cur = q[h]; h++
            if (cur == to) break
            if (dist[cur] >= maxHops) continue
            for (nb in world.neighborIndex[cur]) {
                if (prev[nb] != -2 || world.ownerId[nb] != holderId) continue // 내 소유 동만 밟는다
                prev[nb] = cur
                dist[nb] = dist[cur] + 1
                q.add(nb)
            }
        }
        if (prev[to] == -2) return null
        val rev = ArrayList<Int>()
        var c = to
        while (c != -1) { rev.add(c); c = prev[c] }
        rev.reverse()
        return rev
    }

    // 매 tick 호출 — 도착한 유닛을 처리하고 목록에서 제거. 릴레이(B1)가 이어지면 다음-홉 order를
    // 반복 순회가 끝난 뒤 world.orders/pendingNewOrders에 추가한다(순회 중 수정 방지).
    fun tickOrders(world: World, config: GameConfig, nowMs: Long) {
        val newLegs = ArrayList<Order>()
        val it = world.orders.iterator()
        while (it.hasNext()) {
            val order = it.next()
            if (nowMs >= order.arriveTick) {
                val leg = resolveArrival(world, config, order, nowMs)
                it.remove()
                if (leg != null) newLegs.add(leg)
            }
        }
        if (newLegs.isNotEmpty()) {
            world.orders.addAll(newLegs)
            world.pendingNewOrders.addAll(newLegs)
        }
    }

    // README §4.3 — 전투 판정. §4.6 토벌 보너스(ENV_BOUNTY)도 여기서 함께 처리한다.
    // 릴레이 컬럼(경로 자동 출정)이면 다음-홉 order를 반환, 아니면 null.
    private fun resolveArrival(world: World, config: GameConfig, order: Order, nowMs: Long): Order? {
        val to = order.to
        val amount = order.amount
        val holderId = order.holderId

        // 공수부대(B3): 도착 시 목적지에 투하하고 상한 초과분을 인접 flood로 점령/증원한다(릴레이 아님).
        if (order.airdrop) {
            resolveAirdrop(world, to, amount, holderId, nowMs)
            return null
        }

        // 경로 자동 출정: 남은 경로가 있고 이 동과 다음 홉이 모두 내 소유면 '통과'만 하고 다음 홉으로 이어간다.
        val path = order.path
        if (path.isNotEmpty() && world.ownerId[to] == holderId && world.ownerId[path[0]] == holderId) {
            return makeOrder(world, config, to, path[0], amount, holderId, nowMs, path.subList(1, path.size).toList())
        }

        if (world.ownerId[to] == holderId) {
            // 증원: 상한까지만 채우고, 넘치는 병력은 출발지로 되돌린다.
            // (같은 동에 여러 출정이 동시에 도착할 때 상한 초과분이 소멸하던 버그 방지 —
            //  출발지는 이 병력을 이미 내보냈으므로 되돌려도 대개 상한 안에 들어간다.)
            val space = (world.troopCap[to] - world.troops[to]).coerceAtLeast(0)
            val accepted = min(amount, space)
            world.troops[to] += accepted
            val overflow = amount - accepted
            if (overflow > 0 && world.ownerId[order.from] == holderId) {
                world.troops[order.from] =
                    min(world.troopCap[order.from], world.troops[order.from] + overflow)
                world.dirty.add(order.from)
            }
        } else {
            // 스폰 방어막은 미사일·전술핵만 막는다 — 유닛 도착 전투는 방어막과 무관하게 정상 진행.
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
                    nowMs,
                )
            } else {
                world.troops[to] = remaining
            }
        }
        world.dirty.add(to)
        return null
    }

    private fun centroidDistance(world: World, from: Int, to: Int): Double {
        val a = world.meta[from].centroid
        val b = world.meta[to].centroid
        val dx = a[0] - b[0]
        val dy = a[1] - b[1]
        return sqrt(dx * dx + dy * dy)
    }

    // 공수 사거리용 거리 — 클라가 그리는 사거리 원(경도 cosLat 보정)과 같은 척도. "원에 걸침=수송 가능" 일치.
    private fun airdropScaledDist(world: World, origin: Int, dest: Int): Double {
        val a = world.meta[origin].centroid
        val b = world.meta[dest].centroid
        val cosLat = cos(a[1] * Math.PI / 180.0)
        val dx = (a[0] - b[0]) * cosLat
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

    // 무작위 동 1곳에 미사일 스폰. 맵 전체 총량이 상한이면 스폰하지 않고, 이미 있는 동은
    // 건너뛴다(개인 보유 한도 없음 — 맵 총량만으로 제한). 반환 = 스폰된 admIndex, 없으면 -1.
    fun trySpawnMissile(world: World, config: GameConfig, rng: java.util.Random): Int {
        if (world.n == 0) return -1
        if (totalMissileCount(world) >= config.missileMaxTotal) return -1 // 맵 전체 상한

        // 시도를 먼저 균등 추첨한 뒤 그 안에서 동을 고른다 — 동 개수가 시도별로 크게
        // 달라서(서울·부산은 동이 촘촘히 쪼개져 있음) 동 단위로 그냥 균등 추첨하면
        // 그쪽에 쏠린다. 시도 단위로 먼저 공평하게 나눠야 전국에 고르게 퍼진다.
        // (개인 보유 한도는 없음 — 맵 총량만으로 제한.)
        val sidoOrder = (world.cellsBySido.indices).toMutableList()
        sidoOrder.shuffle(rng)
        for (sidoIdx in sidoOrder) {
            val cells = world.cellsBySido[sidoIdx]
            if (cells.isEmpty()) continue
            val start = rng.nextInt(cells.size)
            for (k in cells.indices) {
                val i = cells[(start + k) % cells.size]
                if (world.missile[i]) continue
                world.missile[i] = true
                return i
            }
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
            if (isShielded(world, world.ownerId[h], wallNowMs)) continue // 방어막 보호 — 중립화 안 됨
            world.ownerId[h] = HolderIds.NEUTRAL
            world.troops[h] = 0
            world.troopAccum[h] = 0.0
            world.dirty.add(h)
            neutralized.add(h)
        }
        pushLog(world, "미사일 착탄 — ${neutralized.size}개 동 중립화", wallNowMs)
        return MissileLaunch(ok = true, removed = src, neutralized = neutralized)
    }

    // ── 전술핵 사일로 (web/src/game/core.ts launchNuke 대응) ──
    // 울릉도·제주의 사일로 동을 소유한 플레이어는 소모품 미사일 없이도 nukeCooldownSec마다
    // 일반 미사일의 nukeRadiusMult배 반경 미사일을 발사할 수 있다.
    fun launchNuke(
        world: World,
        config: GameConfig,
        holderId: Int,
        hits: List<Int>,
        wallNowMs: Long,
    ): MissileLaunch {
        var ownedK = -1 // 소유 중인 사일로(쿨다운 무관) — 에러 메시지 구분용
        var readyK = -1 // 소유 + 쿨다운 완료
        for (k in world.nukeSilos.indices) {
            val idx = world.nukeSilos[k]
            if (idx < 0 || world.ownerId[idx] != holderId) continue
            if (ownedK < 0) ownedK = k
            if (wallNowMs >= world.nukeReadyAt[k]) {
                readyK = k
                break
            }
        }
        if (ownedK < 0) return MissileLaunch(ok = false, reason = "전술핵 사일로(울릉도·제주)를 보유해야 발사할 수 있습니다.")
        if (readyK < 0) {
            val left = (world.nukeReadyAt[ownedK] - wallNowMs + 999) / 1000
            return MissileLaunch(ok = false, reason = "전술핵 재장전까지 ${left}초 남았습니다.")
        }

        val neutralized = ArrayList<Int>()
        for (h in hits) {
            if (h < 0 || h >= world.n) continue
            if (isShielded(world, world.ownerId[h], wallNowMs)) continue // 방어막 보호 — 중립화 안 됨
            world.ownerId[h] = HolderIds.NEUTRAL
            world.troops[h] = 0
            world.troopAccum[h] = 0.0
            world.dirty.add(h)
            neutralized.add(h)
        }
        world.nukeReadyAt[readyK] = wallNowMs + (config.nukeCooldownSec * 1000).toLong()
        world.nukeDirty = true
        val siloName = world.meta[world.nukeSilos[readyK]].name
        pushLog(world, "☢ 전술핵 착탄(${siloName} 발사) — ${neutralized.size}개 동 중립화", wallNowMs)
        return MissileLaunch(ok = true, removed = world.nukeSilos[readyK], neutralized = neutralized)
    }

    // ── 공수부대 (B3, web/src/game/core.ts tryAirdrop/resolveAirdrop 대응) ──
    // 원으로 고른 내 동들(sources)의 병력 전부를 모아 삼각형 유닛으로 dest에 투하한다. 도착 시
    // resolveAirdrop이 목적지→인접 BFS로 순차 flood한다(적/중립은 전투로 점령, 내 동은 상한까지 증원).

    fun tryAirdrop(
        world: World,
        config: GameConfig,
        sources: List<Int>,
        dest: Int,
        holderId: Int,
        nowMs: Long,
    ): SortieResult {
        if (nowMs < world.airdropReadyAt[holderId]) {
            val left = (world.airdropReadyAt[holderId] - nowMs + 999) / 1000
            return SortieResult.Err(SortieErrorCode.AIRDROP_COOLDOWN, "공수 재사용까지 ${left}초 남았습니다.")
        }
        if (dest < 0 || dest >= world.n) {
            return SortieResult.Err(SortieErrorCode.NO_TROOPS, "투하 목적지가 올바르지 않습니다.")
        }
        val valid = ArrayList<Int>()
        var total = 0
        for (i in sources) {
            if (i < 0 || i >= world.n || world.ownerId[i] != holderId) continue
            valid.add(i)
            total += world.troops[i]
        }
        if (total <= 0) return SortieResult.Err(SortieErrorCode.NO_TROOPS, "수송할 병력이 없습니다.")

        val origin = nearestSourceToCentroid(world, valid, holderId) // 삼각형 유닛 출발 위치(원 중심 근사)
        // 사일로 섬(울릉도·제주) 예외 — 그 섬으로 보내거나 그 섬에서 출발하는 공수는 사거리 무제한.
        // (두 섬은 본토와 인접이 끊겨 있어 공수 외 도달 수단이 없다 — 전술핵 사일로 쟁탈전의 통로.)
        val rangeExempt = world.nukeIslandMask[origin] || world.nukeIslandMask[dest]
        if (!rangeExempt && airdropScaledDist(world, origin, dest) > config.airdropMaxRangeDeg) {
            return SortieResult.Err(SortieErrorCode.AIRDROP_RANGE, "공수 사거리를 벗어났습니다 — 더 가까운 목적지를 선택하세요.")
        }
        for (i in valid) if (world.troops[i] > 0) {
            world.troops[i] = 0 // 전부(100%) 실어 보낸다
            world.dirty.add(i)
        }
        world.airdropReadyAt[holderId] = nowMs + (config.airdropCooldownSec * 1000).toLong()

        // 공수는 일반 유닛보다 조금 느리게(전용 속도·상한) 날아가 수송이 또렷이 보이게 한다.
        val order = makeOrder(
            world, config, origin, dest, total, holderId, nowMs,
            speedDegPerSec = config.airdropSpeedDegPerSec,
            maxSec = config.airdropTravelMaxSec,
        ).copy(airdrop = true)
        world.orders.add(order)
        world.pendingNewOrders.add(order)
        return SortieResult.Ok
    }

    // 선택 동들의 무게중심에 가장 가까운 소유 동 — 삼각형 유닛의 출발 위치(원 중심 근사)로 쓴다.
    private fun nearestSourceToCentroid(world: World, sources: List<Int>, holderId: Int): Int {
        var sx = 0.0
        var sy = 0.0
        var cnt = 0
        for (i in sources) {
            if (i < 0 || i >= world.n || world.ownerId[i] != holderId) continue
            sx += world.meta[i].centroid[0]
            sy += world.meta[i].centroid[1]
            cnt++
        }
        if (cnt == 0) return sources.firstOrNull() ?: 0
        val cx = sx / cnt
        val cy = sy / cnt
        var best = sources[0]
        var bestD = Double.MAX_VALUE
        for (i in sources) {
            if (i < 0 || i >= world.n || world.ownerId[i] != holderId) continue
            val c = world.meta[i].centroid
            val d = (c[0] - cx) * (c[0] - cx) + (c[1] - cy) * (c[1] - cy)
            if (d < bestD) {
                bestD = d
                best = i
            }
        }
        return best
    }

    // 공수 착륙: dest에 투하하고 상한 초과분을 목적지→인접 BFS로 순차 flood한다. 단일 스트림(remaining)이
    // BFS 순서로 각 동을 처리 — 내 동이면 상한까지 증원, 적/중립이면 전투(투하량>방어면 점령 후 상한까지
    // 주둔). 남은 병력 ≤ 방어면 그 동 방어를 깎고 소진·종료. 병력 소진 또는 더 퍼질 동이 없으면 끝.
    private fun resolveAirdrop(world: World, dest: Int, amount: Int, holderId: Int, wallNowMs: Long) {
        var remaining = amount
        val visited = BooleanArray(world.n)
        val queue = ArrayList<Int>()
        queue.add(dest)
        visited[dest] = true
        var captured = 0
        var reinforced = 0
        var qi = 0
        while (qi < queue.size && remaining > 0) {
            val d = queue[qi]; qi++
            if (world.ownerId[d] == holderId) {
                val space = (world.troopCap[d] - world.troops[d]).coerceAtLeast(0)
                val add = min(remaining, space)
                if (add > 0) {
                    world.troops[d] += add
                    remaining -= add
                    world.dirty.add(d)
                    reinforced++
                }
                for (nb in world.neighborIndex[d]) if (!visited[nb]) { visited[nb] = true; queue.add(nb) }
            } else {
                // 방어막은 미사일 전용 — 공수도 유닛 공격이라 방어막 셀에 정상 투하·전투한다.
                val defenders = world.troops[d]
                if (remaining > defenders) {
                    world.ownerId[d] = holderId
                    remaining -= defenders
                    val garrison = min(world.troopCap[d], remaining)
                    world.troops[d] = garrison
                    remaining -= garrison
                    world.dirty.add(d)
                    captured++
                    for (nb in world.neighborIndex[d]) if (!visited[nb]) { visited[nb] = true; queue.add(nb) }
                } else {
                    world.troops[d] = defenders - remaining // 점령 실패 — 방어 병력만 깎고 스트림 소진
                    remaining = 0
                    world.dirty.add(d)
                }
            }
        }
        pushLog(world, "공수 착륙 — ${captured}개 동 점령, ${reinforced}개 동 증원", wallNowMs)
    }

    // ── 공격 목표 자동 보급 (web/src/game/core.ts tickSupply 대응) ────────
    // 공격 목표(attackQueue)를 지정하면 후방 병력이 매 주기 내 영토 경사를 따라 가장 가까운 공격
    // 전선(목표에 인접한 내 동)으로 한 홉씩 자동 전진한다(내 소유 동 사이 흐름, 전투 없음). 전선에
    // 모인 병력은 tickAttackQueue가 목표로 내보낸다. 예전 집결지(rally)를 대체한다.

    // 공격 목표를 가진 모든 holder에 대해 후방 병력을 전선 방향으로 한 홉씩 전진(GameLoop이 주기 호출).
    // 새 보급 유닛(order)은 world.orders/pendingNewOrders에 추가돼 다음 DELTA로 퍼진다.
    fun tickSupply(world: World, config: GameConfig, nowMs: Long) {
        for (h in world.attackQueue.indices) {
            if (world.attackQueue[h].isEmpty()) continue
            supplyTowardFronts(world, config, h, world.attackQueue[h], nowMs)
        }
    }

    // 전선(공격 목표에 인접한 내 동) = 거리 0인 다중 소스에서 내 영토 위로 BFS 홉거리를 구하고, 각 후방
    // 동이 '전선에 한 칸 더 가까운' 이웃으로 병력 일부를 행군(order)시킨다 — 여러 목표가 있으면 가장 가까운
    // 목표 쪽으로 흐른다. 도착 처리(증원·상한 초과분 반환)는 tickOrders/resolveArrival가 일반 출정과 동일.
    private fun supplyTowardFronts(world: World, config: GameConfig, holderId: Int, targets: Set<Int>, nowMs: Long) {
        val dist = IntArray(world.n) { -1 }
        val q = ArrayList<Int>()
        // 전선: 공격 목표에 인접한 내 동(거리 0). 여러 목표에서 동시에 퍼지는 다중 소스 BFS.
        for (target in targets) {
            if (target < 0 || target >= world.n) continue
            for (nb in world.neighborIndex[target]) {
                if (world.ownerId[nb] == holderId && dist[nb] == -1) {
                    dist[nb] = 0
                    q.add(nb)
                }
            }
        }
        var k = 0
        while (k < q.size) {
            val cur = q[k]; k++
            for (nb in world.neighborIndex[cur]) {
                if (dist[nb] != -1 || world.ownerId[nb] != holderId) continue
                dist[nb] = dist[cur] + 1
                q.add(nb)
            }
        }
        // 후방 동(거리>0)만 전진시킨다 — 전선(거리 0)의 병력은 tickAttackQueue가 목표 공격에 쓴다.
        for (idx in q.indices) {
            val i = q[idx]
            if (dist[i] <= 0) continue
            if (world.troops[i] <= config.supplyMinTroops) continue
            var j = -1 // 전선에 한 칸 더 가까운 이웃
            for (nb in world.neighborIndex[i]) {
                if (dist[nb] == dist[i] - 1) { j = nb; break }
            }
            if (j < 0) continue
            val space = world.troopCap[j] - world.troops[j]
            if (space <= 0) continue // 앞이 가득 차면 출발 안 함(불필요한 왕복 방지)
            var amt = floor(world.troops[i] * config.supplyRatio).toInt()
            if (amt < 1) continue
            if (amt > space) amt = space
            // 병력은 즉시 출발지를 떠나(차감) 이웃으로 행군한다. 도착 시 tickOrders가 증원 처리(초과분 반환).
            world.troops[i] -= amt
            world.dirty.add(i)
            val order = makeOrder(world, config, i, j, amt, holderId, nowMs)
            world.orders.add(order)
            world.pendingNewOrders.add(order)
        }
    }

    // ── 공격 큐 (web/src/game/core.ts toggleAttackTarget/tickAttackQueue 대응) ────
    // 국경에 인접한 적·중립 지역을 큐에 넣으면, 매 주기 인접한 내 동들이 그 지역을 자동 공격한다.
    // 대상이 내 소유가 되면(점령) 큐에서 자동 제거. 우클릭 드래그 공격을 대체한다.

    // 공격 대상 토글. 이미 큐에 있으면 해제(항상 허용), 없으면 적·중립 + 내 영토 인접일 때만 추가.
    fun toggleAttackTarget(world: World, holderId: Int, idx: Int) {
        if (idx < 0 || idx >= world.n) return
        val q = world.attackQueue[holderId]
        if (q.contains(idx)) {
            q.remove(idx)
            return
        }
        if (world.ownerId[idx] == holderId) return // 내 동은 큐에 못 넣음
        var adjacent = false
        for (nb in world.neighborIndex[idx]) {
            if (world.ownerId[nb] == holderId) { adjacent = true; break }
        }
        if (!adjacent) return // 내 영토에 인접해야 큐에 넣는다
        q.add(idx)
    }

    // 큐를 가진 모든 holder에 대해, 각 대상에 인접한 내 동들이 병력 일부를 그 대상으로 출정시킨다.
    // (GameLoop이 attackQueueIntervalSec 주기로 호출.) 새 order는 orders/pendingNewOrders에 추가돼 DELTA로 전파.
    fun tickAttackQueue(world: World, config: GameConfig, nowMs: Long) {
        for (h in world.attackQueue.indices) {
            val q = world.attackQueue[h]
            if (q.isEmpty()) continue
            for (target in q.toList()) {
                if (target < 0 || target >= world.n) { q.remove(target); continue }
                if (world.ownerId[target] == h) { q.remove(target); continue } // 점령 완료 → 제거
                for (nb in world.neighborIndex[target]) {
                    if (world.ownerId[nb] != h) continue
                    if (world.troops[nb] <= config.attackQueueMinTroops) continue
                    val amt = floor(world.troops[nb] * config.attackQueueRatio).toInt()
                    if (amt < 1) continue
                    world.troops[nb] -= amt
                    world.dirty.add(nb)
                    val order = makeOrder(world, config, nb, target, amt, h, nowMs)
                    world.orders.add(order)
                    world.pendingNewOrders.add(order)
                }
            }
        }
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

    // 라운드 지배 판정 — web/src/game/core.ts dominationHolder 대응. 1위가 전국의 roundWinRatio
    // 이상 점유 시 그 holderId, 아니면 -1. 시간 종료는 GameLoop에서 시각 비교로 따로 처리.
    fun dominationHolder(world: World, config: GameConfig): Int {
        if (world.n == 0) return -1
        val leader = getLeaderboard(world).firstOrNull() ?: return -1
        val threshold = ceil(world.n * config.roundWinRatio).toInt()
        return if (leader.count >= threshold) leader.holderId else -1
    }

    // README §6 — 계급은 저장하지 않고 소유권에서 매번 파생.
    fun computeRank(world: World, config: GameConfig, holderId: Int): Rank? {
        if (holderId == HolderIds.NEUTRAL || world.n == 0) return null

        val sidoTotal = HashMap<String, Int>()
        val sidoOwned = HashMap<String, Int>()
        var anyOwned = false
        var ownedCells = 0

        for (i in 0 until world.n) {
            val sido = world.meta[i].sidocd
            sidoTotal[sido] = (sidoTotal[sido] ?: 0) + 1
            if (world.ownerId[i] == holderId) {
                anyOwned = true
                ownedCells++
                sidoOwned[sido] = (sidoOwned[sido] ?: 0) + 1
            }
        }
        if (!anyOwned) return null

        // 전국 완전 장악(100%)은 사실상 불가능에 가까우므로, 전체 동의 PRESIDENT_WIN_RATIO(40%)
        // 이상을 점유하면 대통령으로 인정한다(web/src/game/core.ts computeRank 1:1).
        val presidentThreshold = ceil(world.n * config.presidentWinRatio).toInt()
        if (ownedCells >= presidentThreshold) return Rank.PRESIDENT

        val fullSido = sidoTotal.count { (sido, total) -> (sidoOwned[sido] ?: 0) == total }
        if (fullSido > 0) return Rank.DOJISA // 시도(예: 강원도) 하나를 통째로 장악

        // 법정동 시절엔 "시군구 하나 통째로 장악=시장"이었지만, 시/군/구 지도는 셀 하나가 이미
        // 시군구 하나 전체라 그 판정이 땅을 조금이라도 가지면 항상 참이 된다 — 그래서 시장 계급은
        // 보유 개수(mayorRankCells) 기준으로 대체하고, 그 아래는 구청장(시/군/구 진입 단계)이다.
        if (ownedCells >= config.mayorRankCells) return Rank.SIJANG

        return Rank.GUCHEONGJANG
    }

    // ── 포위 귀속 (Encirclement Capture, web/src/game/core.ts tickAnnex 1:1) ────────────
    // 어떤 플레이어 P가 '자기 동만으로' 완전히 둘러싼 영역이, 전부 단일 실제 플레이어 Q
    // (중립·야만인 제외) 소유이고, 그 상태를 ANNEX_HOLD_SEC초 연속 유지하면 그 영역 전체를
    // P가 흡수한다(병력 0 리셋). 크기 제한 없음. GameLoop이 매 tick 호출.
    // nowMs=wallNowMs 둘 다 서버 벽시계(GameLoop이 이미 그렇게 호출 — tickOrders와 동일 관례).
    fun tickAnnex(world: World, config: GameConfig, nowMs: Long, wallNowMs: Long) {
        val curBy = IntArray(world.n) { -1 } // 이번 tick에 각 동을 포위 중인 holderId(-1=없음)

        val players = realPlayerIds(world)
        // 포위하는 쪽(P)과 둘러싸이는 쪽(Q)이 둘 다 실제 플레이어여야 하므로 최소 2명 필요.
        if (players.size >= 2) {
            val visited = BooleanArray(world.n)
            for (p in players) {
                visited.fill(false)
                for (start in 0 until world.n) {
                    if (world.ownerId[start] == p || visited[start]) continue
                    // P가 아닌 동들의 연결요소를 DFS로 모은다(P 동은 '벽'이라 통과 불가).
                    val comp = ArrayList<Int>()
                    val owner0 = world.ownerId[start]
                    var singleOwner = true
                    var touchesBorder = false
                    val stack = ArrayDeque<Int>()
                    stack.addLast(start)
                    visited[start] = true
                    while (stack.isNotEmpty()) {
                        val c = stack.removeLast()
                        comp.add(c)
                        if (world.borderMask[c]) touchesBorder = true
                        if (world.ownerId[c] != owner0) singleOwner = false
                        for (nb in world.neighborIndex[c]) {
                            if (world.ownerId[nb] != p && !visited[nb]) {
                                visited[nb] = true
                                stack.addLast(nb)
                            }
                        }
                    }
                    // 경계(바깥)에 못 닿고(=P가 완전 봉쇄) + 전부 단일 실제 플레이어 소유 + 방어막 없음이면 포위 후보.
                    if (!touchesBorder && singleOwner && isRealPlayer(owner0) && !isShielded(world, owner0, nowMs)) {
                        for (c in comp) curBy[c] = p
                    }
                }
            }
        }

        // 유지 타이머 갱신 + ANNEX_HOLD_SEC 유지 시 흡수.
        val holdMs = (config.annexHoldSec * 1000).toLong()
        data class Group(val p: Int, val q: Int, var count: Int)
        val groups = LinkedHashMap<String, Group>()
        for (c in 0 until world.n) {
            val p = curBy[c]
            if (p < 0) {
                // 더는 포위 안 됨(벽이 뚫렸거나 조건 미충족) → 타이머 리셋.
                world.enclosedBy[c] = -1
                world.enclosedSince[c] = 0
                continue
            }
            if (world.enclosedBy[c] != p) {
                world.enclosedBy[c] = p // 새로 포위 시작 → 유지 시간 0부터.
                world.enclosedSince[c] = nowMs
            } else if (nowMs - world.enclosedSince[c] >= holdMs) {
                val q = world.ownerId[c]
                world.ownerId[c] = p // 흡수: 소유권 이전, 병력 0부터 다시 시작.
                world.troops[c] = 0
                world.troopAccum[c] = 0.0
                world.enclosedBy[c] = -1
                world.enclosedSince[c] = 0
                world.dirty.add(c)
                val key = "$p:$q"
                groups.getOrPut(key) { Group(p, q, 0) }.count++
            }
        }

        for (g in groups.values) {
            val pName = world.holders[g.p]?.name ?: "?"
            val qName = world.holders[g.q]?.name ?: "?"
            pushLog(world, "${pName}가 ${qName} 포위 — ${g.count}개 동 흡수", wallNowMs)
        }
    }

    // 실제 플레이어 = 중립(0)·환경 세력(255)이 아닌 holder.
    private fun isRealPlayer(holderId: Int): Boolean = holderId != HolderIds.NEUTRAL && holderId != HolderIds.ENV

    // 현재 동을 1개 이상 소유한 실제 플레이어 id 목록.
    private fun realPlayerIds(world: World): List<Int> {
        val set = LinkedHashSet<Int>()
        for (i in 0 until world.n) {
            val o = world.ownerId[i]
            if (isRealPlayer(o)) set.add(o)
        }
        return set.toList()
    }

    // ── 궤멸 후 재시작 ────────────────────────────────────────────────
    // 미사일 직격(내 유일한 동이 중립화)이나 전투 패배로 플레이어가 소유 동 0개가 되면
    // 두 번 다시 아무것도 할 수 없는 궤멸 상태가 된다(SORTIE는 내 소유 동에서만 가능하므로).
    // 클라가 이 순간을 감지해 GAME OVER 오버레이를 띄우고, 유저가 "재시작" 버튼을 누르면
    // RestartController가 이 함수를 호출한다 — 예전엔 매 tick 자동으로 재배정했지만, 그러면
    // 게임오버 순간 자체가 안 보여서(바로 다음 tick에 이미 부활해 있음) 유저 요청 시로 바꿨다.
    // 아직 살아있으면(소유 동 > 0) 무시. E(255)는 대상 아님(재스폰 없음, README §4.6).
    fun respawnPlayer(world: World, config: GameConfig, holderId: Int, wallNowMs: Long): Boolean {
        val holder = world.holders[holderId] ?: return false
        if (!isRealPlayer(holderId)) return false
        if (ownedCount(world, holderId) > 0) return false // 아직 안 죽음 — 무시

        val newCell = StartCellAssigner.pick(world) ?: return false // 빈 중립 동이 없음
        world.ownerId[newCell] = holderId
        world.troops[newCell] = world.troopCap[newCell]
        world.dirty.add(newCell)
        applyShield(world, config, holderId, wallNowMs)
        pushLog(world, "${holder.name}님이 재시작해 ${world.meta[newCell].name}에서 다시 시작합니다.", wallNowMs)
        return true
    }

    // ── 스폰 방어막 ───────────────────────────────────────────────────
    // 신규 참가·재시작 직후 SPAWN_SHIELD_SEC 동안 그 플레이어의 동은 미사일·전술핵 중립화와
    // 포위 귀속으로부터 보호된다. 유닛 공격(출정·행군·공수)은 방어막과 무관하게 정상 전투 —
    // 방어막은 원거리 즉사 수단만 막는다. SessionService(신규 참가)와
    // respawnPlayer(재시작) 둘 다 이 함수로 부여한다 — 시작 계기가 뭐든 규칙은 하나.
    fun applyShield(world: World, config: GameConfig, holderId: Int, wallNowMs: Long) {
        val until = wallNowMs + (config.spawnShieldSec * 1000).toLong()
        world.shieldUntil[holderId] = until
        world.pendingShields.add(ShieldInfo(holderId, until))
    }

    // holderId가 지금(wallNowMs 기준) 방어막으로 보호되는 실제 플레이어인가.
    fun isShielded(world: World, holderId: Int, wallNowMs: Long): Boolean =
        isRealPlayer(holderId) && wallNowMs < world.shieldUntil[holderId]
}
