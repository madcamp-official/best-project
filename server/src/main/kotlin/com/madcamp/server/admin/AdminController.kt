package com.madcamp.server.admin

import com.madcamp.server.config.ConfigService
import com.madcamp.server.config.GameConfig
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
) {
    @GetMapping("/healthz")
    fun healthz(): String = "ok"

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
