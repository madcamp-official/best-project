package com.madcamp.server.domain

import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.HolderIds
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

    /** 서버 기동 시 1회 — 외곽 동 중 ENV_START_CELLS개를 E에 배정(README §4.6 "시작"). */
    fun spawn(world: World, config: GameConfig) {
        world.holders[HolderIds.ENV] = Holder(HolderIds.ENV, "환경 세력", -1)

        var cx = 0.0
        var cy = 0.0
        for (m in world.meta) {
            cx += m.centroid[0]
            cy += m.centroid[1]
        }
        cx /= world.n
        cy /= world.n

        // "외곽" 근사치: 인접 차수가 낮을수록(해안/경계) + 전국 중심에서 멀수록 점수가 높다.
        // 완전 고립(인접 0, 섬·월경지)은 확장이 불가능하므로 제외한다(README §2.3, §6).
        val candidates = (0 until world.n)
            .filter { world.neighborIndex[it].isNotEmpty() }
            .sortedByDescending { i ->
                val dx = world.meta[i].centroid[0] - cx
                val dy = world.meta[i].centroid[1] - cy
                sqrt(dx * dx + dy * dy) / (world.neighborIndex[i].size + 1)
            }

        val picked = candidates.take(config.envStartCells)
        for (i in picked) {
            world.ownerId[i] = HolderIds.ENV
            world.troops[i] = world.troopCap[i]
            world.dirty.add(i)
        }
        GameCore.pushLog(world, "환경 세력이 외곽 ${picked.size}개 동에서 등장했습니다.", System.currentTimeMillis())
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
