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
     * 고립 동(인접 0 — 섬·월경지)은 제외한다(거기 두면 자라지도 싸우지도 못한다).
     * 배정 가능한 중립 동이 전혀 없으면 null.
     */
    fun pick(world: World): Int? {
        val usable = (0 until world.n).filter {
            world.ownerId[it] == HolderIds.NEUTRAL && world.neighborIndex[it].isNotEmpty()
        }
        // 폴백: 고립 여부 불문 아무 중립 동(전부 섬이거나 맵이 거의 가득 찬 극단 상황).
        val pool = usable.ifEmpty { (0 until world.n).filter { world.ownerId[it] == HolderIds.NEUTRAL } }
        if (pool.isEmpty()) return null

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
