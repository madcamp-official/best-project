package com.madcamp.server.ranking

import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Service
import java.util.concurrent.Executors

/**
 * 명예의 전당 — 라운드 우승 횟수 누적 랭킹(Redis ZSET). 방·라운드·재배포를 넘어 전역으로 쌓인다.
 * H2의 계정 전적(AppUser.wins)은 구글 로그인 사용자만 대상이지만, 여기는 게스트 포함
 * 닉네임 기준 전체 랭킹이다(캠프 데모 특성상 대부분 게스트 접속).
 *
 * 가용성 규약: Redis가 없어도 게임은 완전 정상이어야 한다.
 *  - 기록(recordWin)은 게임 루프 스레드에서 불리므로 전용 스레드로 넘긴다 — tick이 Redis I/O에 안 막힘.
 *  - 실패하면 30초간 재시도를 멈춘다(다운된 Redis에 매 요청 타임아웃 대기하는 것 방지).
 */
@Service
class RankingService(private val redis: StringRedisTemplate) {
    private val log = LoggerFactory.getLogger(RankingService::class.java)
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "ranking").apply { isDaemon = true } }

    @Volatile private var unavailableUntilMs = 0L

    /** 라운드 우승 1회 기록. 게임 루프 스레드에서 호출해도 안전(비동기, 실패 무해). */
    fun recordWin(nickname: String) {
        if (nickname.isBlank()) return
        executor.execute {
            guard {
                redis.opsForZSet().incrementScore(HALL_OF_FAME_KEY, nickname, 1.0)
            }
        }
    }

    /** 우승 횟수 상위 limit명. Redis 미가용이면 빈 목록(호출부는 "랭킹 없음"으로 취급). */
    fun topWins(limit: Long): List<RankRow> =
        guard {
            redis.opsForZSet().reverseRangeWithScores(HALL_OF_FAME_KEY, 0, limit - 1)
                ?.map { RankRow(it.value ?: "?", (it.score ?: 0.0).toInt()) }
        } ?: emptyList()

    /** Redis 호출 공통 가드 — 실패 시 null을 돌려주고 RETRY_BACKOFF_MS 동안 회로를 연다. */
    private fun <T> guard(block: () -> T?): T? {
        if (System.currentTimeMillis() < unavailableUntilMs) return null
        return try {
            block()
        } catch (e: Exception) {
            unavailableUntilMs = System.currentTimeMillis() + RETRY_BACKOFF_MS
            log.warn("Redis 접근 실패 — {}초 동안 랭킹 기능을 쉰다: {}", RETRY_BACKOFF_MS / 1000, e.message)
            null
        }
    }

    @PreDestroy
    fun shutdown() {
        executor.shutdown()
    }

    companion object {
        const val HALL_OF_FAME_KEY = "hof:wins" // ZSET: member=닉네임, score=누적 우승 수
        private const val RETRY_BACKOFF_MS = 30_000L
    }
}

data class RankRow(val name: String, val wins: Int)
