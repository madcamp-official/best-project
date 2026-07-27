package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.SortieResult
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.MarchCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * B1 경로 자동 출정(C→S, /app/march). 검증·경로 탐색은 GameCore.tryMarch가 전부 담당한다 —
 * 멀리 있는 내 동을 우클릭하면 내 영토를 따라 최단 경로로 연쇄 출정(릴레이 컬럼)을 발주한다.
 * 성공 시 world가 dirty해지고 다음 tick의 DELTA(cells + newOrders)로 퍼진다. 실패(경로 없음 등)만
 * 요청자에게 ERROR로 돌려준다. (구조/취지는 SortieController와 동일.)
 */
@Controller
class MarchController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
    private val configService: ConfigService,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/march")
    fun march(@Payload cmd: MarchCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return

        gameLoop.submitOnRoom(binding.roomId) { world ->
            val config = configService.current
            // 클라 입력(ratio)은 신뢰하지 않고 안전 범위로 클램프한다(SortieController와 동일).
            val safeRatio = cmd.ratio?.takeIf { it.isFinite() }?.coerceIn(0.05, 1.0) ?: config.sortieRatio
            val result = GameCore.tryMarch(world, config, cmd.from, cmd.to, binding.holderId, System.currentTimeMillis(), safeRatio)
            if (result is SortieResult.Err) {
                messagingTemplate.convertAndSendToUser(
                    principal.name,
                    "/queue/error",
                    ErrorMessage(result.code.name, result.message, cmd.from, cmd.to),
                )
            }
        }
    }
}
