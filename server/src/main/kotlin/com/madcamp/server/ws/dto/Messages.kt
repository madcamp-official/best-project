package com.madcamp.server.ws.dto

import com.madcamp.server.config.GameConfig
import com.madcamp.server.domain.DongStaticMeta
import com.madcamp.server.domain.Holder
import com.madcamp.server.domain.LeaderboardRow
import com.madcamp.server.domain.LogEvent
import com.madcamp.server.domain.Order

// docs/api-spec.md §2 그대로 대응하는 STOMP 페이로드. 필드 하나하나가 문서의 표와 1:1.

data class JoinMessage(val nickname: String? = null, val token: String? = null)

data class WelcomeMessage(
    val holderId: Int,
    val token: String,
    val paletteIdx: Int,
    val config: GameConfig,
    val serverTimeMs: Long,
    val meta: List<DongStaticMeta>,
    val neighborIndex: List<IntArray>,
    val ownerId: IntArray,
    val troops: IntArray,
    val troopCap: IntArray,
    val holders: List<Holder>,
    val orders: List<Order>,
)

// ratio: 플레이어가 UI 슬라이더로 정한 이번 출정 병력 비율(0~1). 생략/비정상값이면
// 서버가 CONFIG.SORTIE_RATIO로 대체한다(web/src/net/protocol.ts §2.3과 동일 계약).
data class SortieCommand(val from: Int, val to: Int, val ratio: Double? = null)

data class ErrorMessage(val code: String, val message: String, val from: Int, val to: Int)

/** cells: [admIndex, ownerId, troops] 튜플 (api-spec.md §2.5). */
data class DeltaMessage(
    val serverTimeMs: Long,
    val cells: List<IntArray>,
    val newOrders: List<Order>,
    val events: List<LogEvent>,
)

data class LeaderboardMessage(
    val rows: List<LeaderboardRow>,
    val envCells: Int,
    val totalCells: Int,
)
