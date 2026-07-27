package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.SortieResult
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.AirdropCommand
import com.madcamp.server.ws.dto.ErrorMessage
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 공수부대(병력 수송, C→S, /app/airdrop). 검증(소유·쿨타임)은 GameCore.tryAirdrop이 전부 담당한다.
 * 성공 시 삼각형 order가 world에 실려 다음 GameLoop tick의 DELTA로 퍼지고, 도착 시 목적지→인접
 * flood로 점령/증원된다. 실패(쿨타임·병력 없음)만 요청자에게 ERROR로 돌려준다.
 * (검증 순서/취지는 SortieController와 동일 — 클라 입력 sources는 tryAirdrop이 내 소유로 재확인.)
 */
@Controller
class AirdropController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
    private val configService: ConfigService,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/airdrop")
    fun airdrop(@Payload cmd: AirdropCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return

        gameLoop.submitOnRoom(binding.roomId) { world ->
            val result = GameCore.tryAirdrop(
                world,
                configService.current,
                cmd.sources,
                cmd.dest,
                binding.holderId,
                System.currentTimeMillis(),
            )
            if (result is SortieResult.Err) {
                messagingTemplate.convertAndSendToUser(
                    principal.name,
                    "/queue/error",
                    ErrorMessage(result.code.name, result.message, -1, cmd.dest),
                )
            }
        }
    }
}
