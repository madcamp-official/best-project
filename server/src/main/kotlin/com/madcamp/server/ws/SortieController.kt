package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.SortieResult
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.SortieCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * api-spec.md §2.3~§2.4 — SORTIE(C→S) 검증은 GameCore.trySortie가 전부 담당한다.
 * 성공 시 world가 dirty해지고 다음 GameLoop tick의 DELTA로 알아서 퍼진다 —
 * 여기서는 실패(ERROR)만 요청자에게 별도로 쏴준다.
 */
@Controller
class SortieController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
    private val configService: ConfigService,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/sortie")
    fun sortie(@Payload cmd: SortieCommand, principal: Principal) {
        val holderId = connectionRegistry.holderIdOf(principal.name) ?: return

        gameLoop.submitOnLoop { world ->
            val config = configService.current
            // web/src/net/localConnection.ts sendSortie와 동일한 안전 범위(0.05~1) 클램프.
            // 클라 입력은 신뢰하지 않는다 — 여기(경계)에서 걸러 순수 코어(GameCore)엔 항상 유효값만 넘긴다.
            val safeRatio = cmd.ratio?.takeIf { it.isFinite() }?.coerceIn(0.05, 1.0) ?: config.sortieRatio
            val result = GameCore.trySortie(world, config, cmd.from, cmd.to, holderId, System.currentTimeMillis(), safeRatio)
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
