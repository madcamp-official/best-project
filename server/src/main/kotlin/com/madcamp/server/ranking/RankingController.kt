package com.madcamp.server.ranking

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** 명예의 전당 조회(REST). Redis 미가용이면 빈 배열 — 클라는 랭킹 섹션을 그냥 숨기면 된다. */
@RestController
class RankingController(private val rankingService: RankingService) {
    @GetMapping("/ranking/top")
    fun top(@RequestParam(defaultValue = "10") limit: Long): List<RankRow> =
        rankingService.topWins(limit.coerceIn(1, 50))
}
