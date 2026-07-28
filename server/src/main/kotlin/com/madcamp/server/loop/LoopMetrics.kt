package com.madcamp.server.loop

import org.springframework.stereotype.Component
import java.util.concurrent.atomic.AtomicLong

/**
 * 게임 루프 틱 소요시간 계측(부하 테스트·운영 관찰용). GameLoop 스레드가 기록하고
 * /admin/metrics(HTTP 스레드)가 읽는다 — 원자 변수라 락 없이 안전하다.
 * 스크레이프 구간별 수치를 보기 위해 snapshot()이 읽으면서 리셋한다.
 */
@Component
class LoopMetrics {
    private val tickCount = AtomicLong()
    private val tickTotalNanos = AtomicLong()
    private val tickMaxNanos = AtomicLong()

    fun recordTick(durationNanos: Long) {
        tickCount.incrementAndGet()
        tickTotalNanos.addAndGet(durationNanos)
        tickMaxNanos.accumulateAndGet(durationNanos) { cur, new -> maxOf(cur, new) }
    }

    /** 마지막 snapshot 이후 구간의 통계를 돌려주고 리셋한다. */
    fun snapshot(): TickStats {
        val count = tickCount.getAndSet(0)
        val total = tickTotalNanos.getAndSet(0)
        val max = tickMaxNanos.getAndSet(0)
        return TickStats(
            count = count,
            avgMs = if (count > 0) total / count / 1e6 else 0.0,
            maxMs = max / 1e6,
        )
    }
}

data class TickStats(val count: Long, val avgMs: Double, val maxMs: Double)
