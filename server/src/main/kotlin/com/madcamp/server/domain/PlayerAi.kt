package com.madcamp.server.domain

import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.HolderIds
import com.madcamp.server.config.Palette
import kotlin.math.floor

/**
 * AI 플레이어 — 한 세션의 참가 인원이 aiFillTarget(기본 8)명에 못 미치면 부족분을 채우는 봇.
 * 야만인(E)을 대체한다. 사람과 달리 WebSocket 연결이 없어 미사일/전술핵/공수는 아예 발사할 수
 * 없고(그 명령들은 연결된 principal에서만 들어온다), 여기서는 두 가지 순수 행동만 한다:
 *   1) 확장 — 국경 동에서 인접한 약한 적/중립으로 이길 만할 때 출정(trySortie 재사용, 여러 전선 동시)
 *   2) 증원 — 후방(비국경) 동의 남는 병력을 프런티어 방향으로 한 홉씩 흘려보내 전선을 먹인다
 * 실력을 일부러 낮추진 않되(적절한 긴장감), 생산량만 사람의 aiProdMult배(80%)로 약간 불리하게 둔다.
 */
object PlayerAi {
    // AI 닉네임 풀 — 사람처럼 보이되 AI임을 알아채기 쉬운 어감. (aiFillTarget=8까지 겹치지 않게 8개.)
    private val NAMES = listOf("도전자", "맞수", "용병", "야망가", "정복자", "반란군", "책략가", "맹장")

    /** 라운드 시작 시 1회 — 현재 실제 플레이어(사람+AI) 수가 target 미만이면 AI 홀더로 채운다. */
    fun fill(world: World, config: GameConfig, target: Int) {
        val nowMs = System.currentTimeMillis()
        var seq = 0
        while (playerCount(world) < target) {
            val start = StartCellAssigner.pick(world) ?: break // 빈 중립 동이 없음(맵이 가득 참)
            val holderId = world.allocateHolderId()
            val name = NAMES[seq % NAMES.size]
            seq++
            val paletteIdx = Palette.PLAYER_IDXS[(holderId - 1).mod(Palette.PLAYER_IDXS.size)]
            val holder = Holder(holderId, name, paletteIdx, isAi = true)
            world.holders[holderId] = holder
            world.pendingNewHolders.add(holder) // 이미 접속 중인 클라도 색을 알도록 DELTA에 실린다
            world.ownerId[start] = holderId
            world.troops[start] = world.troopCap[start]
            world.dirty.add(start)
            GameCore.applyShield(world, config, holderId, nowMs) // 사람과 동일한 스폰 방어막
            GameCore.pushLog(world, "${world.meta[start].name}에서 AI ${name}이(가) 참전했습니다.", nowMs)
        }
    }

    /** 라이브 조인으로 사람이 들어와 정원을 넘겼을 때, 가장 약한 AI 하나를 빼 자리를 내준다.
     *  그 AI의 영토는 중립화된다. 뺄 AI가 없으면 false. */
    fun removeWeakest(world: World, config: GameConfig, nowMs: Long): Boolean {
        val weakest = world.holders.values
            .filter { it.isAi }
            .minByOrNull { GameCore.ownedCount(world, it.id) } ?: return false
        for (i in 0 until world.n) {
            if (world.ownerId[i] == weakest.id) {
                world.ownerId[i] = HolderIds.NEUTRAL
                world.troops[i] = config.neutralTroops
                world.troopAccum[i] = 0.0
                world.dirty.add(i)
            }
        }
        world.holders.remove(weakest.id)
        GameCore.pushLog(world, "AI ${weakest.name}이(가) 자리를 비웠습니다.", nowMs)
        return true
    }

    /** 매 AI 주기(aiActIntervalSec) 호출 — 모든 AI 홀더가 한 번씩 행동한다. */
    fun actAll(world: World, config: GameConfig, nowMs: Long) {
        // holders를 순회 중 removeWeakest 등으로 구조가 바뀌지 않으므로 값 복사 없이 순회해도 안전하나,
        // act 자체가 world.holders를 건드리지 않으니 그대로 순회한다.
        for (holder in world.holders.values) {
            if (holder.isAi) act(world, config, holder.id, nowMs)
        }
    }

    private fun act(world: World, config: GameConfig, holderId: Int, nowMs: Long) {
        expand(world, config, holderId, nowMs)
        reinforce(world, config, holderId, nowMs)
    }

    // 1) 확장 — 내 국경 동마다 "이길 만한" 가장 약한 인접 적/중립을 골라, 이득 큰 순으로 상위 K개만 출정.
    private fun expand(world: World, config: GameConfig, holderId: Int, nowMs: Long) {
        // (from, to, score) — score = 도착 병력 − 대상 병력(클수록 확실한 이득).
        data class Move(val from: Int, val to: Int, val score: Double)
        val moves = ArrayList<Move>()
        for (i in 0 until world.n) {
            if (world.ownerId[i] != holderId) continue
            val send = floor(world.troops[i] * config.sortieRatio).toInt()
            if (send <= 0) continue
            // i의 인접 중 비소유·비방어막 동에서 병력 최소 대상.
            var best = -1
            var bestT = Int.MAX_VALUE
            for (nb in world.neighborIndex[i]) {
                val o = world.ownerId[nb]
                if (o == holderId) continue
                if (GameCore.isShielded(world, o, nowMs)) continue // 방어막 = 공격해도 병력만 소멸(낭비)
                if (world.troops[nb] < bestT) {
                    bestT = world.troops[nb]
                    best = nb
                }
            }
            if (best < 0) continue
            if (send > world.troops[best] * config.aiAttackMargin) {
                moves.add(Move(i, best, send - world.troops[best].toDouble()))
            }
        }
        moves.sortByDescending { it.score }
        var done = 0
        val usedFrom = HashSet<Int>() // 한 동은 한 주기에 한 번만 출정(급격한 전면 소진 방지)
        for (m in moves) {
            if (done >= config.aiMaxSortiesPerTick) break
            if (!usedFrom.add(m.from)) continue
            GameCore.trySortie(world, config, m.from, m.to, holderId, nowMs)
            done++
        }
    }

    // 2) 증원 — 프런티어(적/중립에 인접한 내 동)로부터의 거리를 내 영토 위에서 BFS로 재고, 후방의
    //    거의 가득 찬 동이 거리가 더 가까운(=전선 쪽) 이웃으로 병력을 한 홉 흘려보낸다. 생산으로 다시
    //    채워질 때까지 그 동은 쉬므로 주문 폭주 없이 전선이 꾸준히 병력을 공급받는다.
    private fun reinforce(world: World, config: GameConfig, holderId: Int, nowMs: Long) {
        val dist = HashMap<Int, Int>()
        val queue = ArrayDeque<Int>()
        for (i in 0 until world.n) {
            if (world.ownerId[i] != holderId) continue
            if (world.neighborIndex[i].any { world.ownerId[it] != holderId }) {
                dist[i] = 0
                queue.addLast(i)
            }
        }
        while (queue.isNotEmpty()) {
            val c = queue.removeFirst()
            val d = dist.getValue(c)
            for (nb in world.neighborIndex[c]) {
                if (world.ownerId[nb] == holderId && nb !in dist) {
                    dist[nb] = d + 1
                    queue.addLast(nb)
                }
            }
        }

        // 후방(거리>0) 동 중 거의 찬 것부터, 전선 쪽 이웃으로 밀어준다. 주기당 상한으로 주문 수 제한.
        val candidates = dist.entries
            .filter { (i, d) -> d > 0 && world.troops[i] >= world.troopCap[i] * config.aiReinforceFillRatio }
            .sortedByDescending { (i, _) -> world.troops[i] }
        var done = 0
        for ((i, d) in candidates) {
            if (done >= config.aiMaxReinforcePerTick) break
            val target = world.neighborIndex[i].firstOrNull { (dist[it] ?: Int.MAX_VALUE) < d } ?: continue
            GameCore.trySortie(world, config, i, target, holderId, nowMs)
            done++
        }
    }

    private fun playerCount(world: World): Int =
        world.holders.values.count { it.id != HolderIds.NEUTRAL && it.id != HolderIds.ENV }
}
