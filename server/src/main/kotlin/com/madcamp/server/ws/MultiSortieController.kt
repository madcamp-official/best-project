package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.SortieResult
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.MultiSortieCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 드래그 쓸기(C→S, /app/sortie-multi) — 한 출발지에서 여러 인접 목표로 병력을 균등 분할해 동시 출정.
 * 검증·분할은 GameCore.tryMultiSortie가 전부 담당하고, 성공 시 world가 dirty해져 다음 tick의 DELTA로
 * 퍼진다. 여기서는 실패(ERROR)만 요청자에게 쏴준다(SortieController와 동일 구조).
 */
@Controller
class MultiSortieController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
    private val configService: ConfigService,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/sortie-multi")
    fun sortieMulti(@Payload cmd: MultiSortieCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return

        gameLoop.submitOnRoom(binding.roomId) { world ->
            val config = configService.current
            val safeRatio = cmd.ratio?.takeIf { it.isFinite() }?.coerceIn(0.05, 1.0) ?: config.sortieRatio
            val result = GameCore.tryMultiSortie(
                world, config, cmd.from, cmd.targets, binding.holderId, System.currentTimeMillis(), safeRatio,
            )
            if (result is SortieResult.Err) {
                messagingTemplate.convertAndSendToUser(
                    principal.name,
                    "/queue/error",
                    ErrorMessage(result.code.name, result.message, cmd.from, cmd.targets.firstOrNull() ?: -1),
                )
            }
        }
    }
}
