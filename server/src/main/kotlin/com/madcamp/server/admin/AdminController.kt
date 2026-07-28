package com.madcamp.server.admin

import com.madcamp.server.config.ConfigService
import com.madcamp.server.config.GameConfig
import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.loop.LoopMetrics
import com.madcamp.server.loop.TickStats
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

/** api-spec.md §4 — 배포/헬스체크 + CONFIG 런타임 리로드(plan.md §6 밸런스 리스크 대응). */
@RestController
class AdminController(
    private val configService: ConfigService,
    private val objectMapper: ObjectMapper,
    private val loopMetrics: LoopMetrics,
    private val roomManager: RoomManager,
) {
    @GetMapping("/healthz")
    fun healthz(): String = "ok"

    /** 부하 테스트·운영 관찰용 스냅샷. tick 통계는 읽을 때마다 리셋된다(구간 측정용). */
    @GetMapping("/admin/metrics")
    fun metrics(): MetricsResponse {
        val rooms = roomManager.list()
        val runtime = Runtime.getRuntime()
        return MetricsResponse(
            tick = loopMetrics.snapshot(),
            rooms = rooms.size,
            playingRooms = rooms.count { it.state == RoomState.PLAYING },
            members = rooms.sumOf { it.members.size },
            heapUsedMb = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024,
            heapMaxMb = runtime.maxMemory() / 1024 / 1024,
        )
    }

    @GetMapping("/admin/config")
    fun currentConfig(): GameConfig = configService.current

    /** Partial<GameConfig> JSON을 받아 현재 값 위에 덮어쓴다. 필드 생략 시 기존 값 유지. */
    @PostMapping("/admin/config")
    fun updateConfig(@RequestBody partial: JsonNode): GameConfig {
        val updated: GameConfig = objectMapper.readerForUpdating(configService.current).readValue(partial)
        configService.replace(updated)
        return updated
    }
}

data class MetricsResponse(
    val tick: TickStats,
    val rooms: Int,
    val playingRooms: Int,
    val members: Int,
    val heapUsedMb: Long,
    val heapMaxMb: Long,
)
