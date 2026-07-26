package com.madcamp.server.domain

import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.HolderIds
import com.madcamp.server.config.Palette
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round
import kotlin.math.sqrt

/**
 * README §4.6 — 환경 세력(E). 문명의 야만인 모델: 초반 긴장용 조연, 상한이 있어
 * 절대 플레이어를 넘어 맵을 장악하지 못한다. plan.md Day 3 서버 담당 작업.
 */
object EnvAi {

    /**
     * 서버 기동 시 1회 — ENV_CLUSTER_COUNT개의 야만인 무리를 전국에 흩뿌린다(README §4.6 "시작").
     * web/src/net/localConnection.ts pickEnvCells와 같은 구조(씨앗 + 인접 중립 동)를 쓰되,
     * "플레이어 근처" 첫 씨앗 로직은 뺐다 — 서버는 아무도 접속하기 전에 스폰하므로 기준으로 삼을
     * 플레이어가 없다(README §4.6 literal "외곽 스폰"에 맞춰 첫 씨앗도 outer-score 최고점으로).
     */
    fun spawn(world: World, config: GameConfig) {
        // 이름·팔레트는 web/src/config.ts(ENV_PALETTE_IDX)·core.ts(envSpawn "야만인")와 맞춘다.
        world.holders[HolderIds.ENV] = Holder(HolderIds.ENV, "야만인", Palette.ENV_IDX)

        val seeds = pickSeeds(world, max(1, config.envClusterCount))
        val cells = LinkedHashSet<Int>()
        for (seed in seeds) {
            cells.add(seed)
            var inCluster = 1
            for (nb in world.neighborIndex[seed]) {
                if (inCluster >= config.envStartCells) break
                if (world.ownerId[nb] == HolderIds.NEUTRAL && cells.add(nb)) inCluster++
            }
        }

        for (i in cells) {
            world.ownerId[i] = HolderIds.ENV
            world.troops[i] = world.troopCap[i]
            world.dirty.add(i)
        }
        GameCore.pushLog(world, "환경 세력이 외곽 ${seeds.size}개 무리(${cells.size}개 동)에서 등장했습니다.", System.currentTimeMillis())
    }

    // 무리 씨앗 선정: 첫 씨앗은 "외곽" 점수(중심에서 멀수록 + 인접 차수 낮을수록) 최고점,
    // 나머지는 최원점(farthest-point) 샘플링으로 이미 고른 씨앗들에서 가장 먼 중립 동을
    // 반복 선택 — 캠프들이 서로 떨어져 전국에 흩어진다.
    private fun pickSeeds(world: World, count: Int): List<Int> {
        var cx = 0.0
        var cy = 0.0
        for (m in world.meta) {
            cx += m.centroid[0]
            cy += m.centroid[1]
        }
        cx /= world.n
        cy /= world.n

        // 완전 고립(인접 0, 섬·월경지)은 자라지도 싸우지도 못하므로 제외(README §2.3, §6).
        fun usable(i: Int) = world.ownerId[i] == HolderIds.NEUTRAL && world.neighborIndex[i].isNotEmpty()

        val firstSeed = (0 until world.n)
            .filter { usable(it) }
            .maxByOrNull { i ->
                val dx = world.meta[i].centroid[0] - cx
                val dy = world.meta[i].centroid[1] - cy
                sqrt(dx * dx + dy * dy) / (world.neighborIndex[i].size + 1)
            } ?: return emptyList()

        val seeds = mutableListOf(firstSeed)
        while (seeds.size < count) {
            var best = -1
            var bestMinDist = -1.0
            for (i in 0 until world.n) {
                if (!usable(i) || i in seeds) continue
                var minDist = Double.MAX_VALUE
                for (s in seeds) {
                    val d = centroidDistSq(world, i, s)
                    if (d < minDist) minDist = d
                }
                if (minDist > bestMinDist) {
                    bestMinDist = minDist
                    best = i
                }
            }
            if (best < 0) break // 더 둘 곳이 없음
            seeds.add(best)
        }
        return seeds
    }

    private fun centroidDistSq(world: World, a: Int, b: Int): Double {
        val ca = world.meta[a].centroid
        val cb = world.meta[b].centroid
        val dx = ca[0] - cb[0]
        val dy = ca[1] - cb[1]
        return dx * dx + dy * dy
    }

    /** GameLoop이 매 tick 호출. 내부에서 ENV_ACT_INTERVAL_SEC 간격을 직접 관리한다. */
    fun maybeAct(world: World, config: GameConfig, nowMs: Long) {
        if (nowMs - world.envLastActMs < config.envActIntervalSec * 1000) return
        world.envLastActMs = nowMs

        val envCells = GameCore.ownedCount(world, HolderIds.ENV)
        if (envCells == 0) return // 전멸(소탕 완료) — 재스폰 없음(README §4.6)

        val maxPlayerCells = world.holders.values
            .filter { it.id != HolderIds.NEUTRAL && it.id != HolderIds.ENV }
            .maxOfOrNull { GameCore.ownedCount(world, it.id) } ?: 0

        val hardCap = round(config.envMaxRatio * world.n).toInt()
        val neverSurpassCap = max(config.envMinPresence, maxPlayerCells)
        val cap = min(hardCap, neverSurpassCap)
        if (envCells >= cap) return // 상한 도달 — 확장 중단, 방어만(README §4.6)

        // 1) E 보유 동 중 병력 최다 X
        val x = GameCore.ownedIndices(world, HolderIds.ENV).maxByOrNull { world.troops[it] } ?: return
        // 2) X의 인접 동 중 병력 최소 Y (플레이어/중립 구분 없음)
        val y = world.neighborIndex[x].minByOrNull { world.troops[it] } ?: return

        val amount = floor(world.troops[x] * config.sortieRatio)
        if (amount > world.troops[y] * config.envAttackMargin) {
            GameCore.trySortie(world, config, x, y, HolderIds.ENV, nowMs)
        }
    }
}
