package com.madcamp.server.domain

import com.madcamp.server.config.HolderIds

/**
 * 시작 동(또는 재시작 동) 배정. 신규 참가자(SessionService)·AI 채우기(PlayerAi)·궤멸 후 재시작
 * (GameCore.respawnPlayer)이 모두 이걸 쓴다 — "빈손이 된 참가자에게 새 땅을 준다"는 같은 문제.
 * `internal`로 둬서 domain 밖(session 패키지)에서도 쓸 수 있게 한다.
 */
internal object StartCellAssigner {
    // 최원점 대비 이 비율(제곱거리 기준) 이상 떨어진 후보를 "충분히 먼 곳"으로 보고 그중 무작위로 고른다.
    // 1.0에 가까울수록 항상 최원점(고르지만 판마다 비슷), 낮출수록 무작위성↑. 제곱거리라 0.6 ≈ 선형 0.77배.
    private const val FAR_FRACTION = 0.6

    /**
     * 전국에 랜덤하면서도 고르게 퍼지도록 배치한다(최원점 샘플링).
     *  - 아직 아무도 없으면(첫 배치) 완전 무작위 → 판마다 전체 배치가 회전/변형된다.
     *  - 이미 자리 잡은 실제 플레이어가 있으면, "가장 가까운 기존 플레이어까지의 거리"가 충분히
     *    큰(=멀리 떨어진) 후보들 중에서 무작위로 고른다 → 서로 뭉치지 않고 고르게 흩어진다.
     * 무조건 본토(최대 연결 컴포넌트)에서만 배정한다 — 섬(제주·울릉 등 본토와 인접이 끊긴
     * 별도 컴포넌트)은 후보에서 제외한다. 본토에 빈 중립 동이 없으면 null.
     */
    fun pick(world: World): Int? {
        val mainland = mainlandCells(world)
        val pool = (0 until world.n).filter {
            world.ownerId[it] == HolderIds.NEUTRAL && it in mainland
        }
        if (pool.isEmpty()) return null // 본토에 빈 중립 동이 없음 — 섬엔 두지 않는다

        val refs = (0 until world.n).filter {
            val o = world.ownerId[it]
            o != HolderIds.NEUTRAL && o != HolderIds.ENV
        }
        if (refs.isEmpty()) return pool.random() // 첫 배치 — 무작위 시드

        val scored = pool.map { it to nearestRefDistSq(world, it, refs) }
        val maxD = scored.maxOf { it.second }
        val far = scored.filter { it.second >= maxD * FAR_FRACTION }.map { it.first }
        return far.random()
    }

    // 본토(인접 그래프의 최대 연결 컴포넌트) 동 집합. 섬은 별도 컴포넌트라 빠진다. 인접은 정적이라
    // 소유와 무관하게 그래프 구조만으로 계산한다. web/src/game/core.ts largestComponentSet 대응.
    private fun mainlandCells(world: World): Set<Int> {
        val seen = BooleanArray(world.n)
        var best: List<Int> = emptyList()
        for (start in 0 until world.n) {
            if (seen[start]) continue
            val comp = ArrayList<Int>()
            val queue = ArrayDeque<Int>()
            queue.addLast(start)
            seen[start] = true
            while (queue.isNotEmpty()) {
                val c = queue.removeFirst()
                comp.add(c)
                for (nb in world.neighborIndex[c]) {
                    if (!seen[nb]) {
                        seen[nb] = true
                        queue.addLast(nb)
                    }
                }
            }
            if (comp.size > best.size) best = comp
        }
        return best.toHashSet()
    }

    // 후보 c에서 가장 가까운 기존 플레이어 동까지의 제곱거리(경위도).
    private fun nearestRefDistSq(world: World, c: Int, refs: List<Int>): Double {
        val cc = world.meta[c].centroid
        var min = Double.MAX_VALUE
        for (r in refs) {
            val rc = world.meta[r].centroid
            val dx = cc[0] - rc[0]
            val dy = cc[1] - rc[1]
            val d = dx * dx + dy * dy
            if (d < min) min = d
        }
        return min
    }
}
