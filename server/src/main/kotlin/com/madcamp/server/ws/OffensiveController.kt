package com.madcamp.server.ws

import com.madcamp.server.domain.GameCore
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.SetOffensiveCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 공세 목표 지정/해제(C→S, /app/offensive). GameCore.setOffensive가 검증·저장하며, 이후 GameLoop의
 * 공세 주기가 그 목표를 향한 최전선 동을 이길 만한 인접 적·중립으로 자동 전진시킨다. 목표는 그
 * 플레이어의 공세에만 영향을 주고 마커는 클라 로컬(WELCOME.offensive로 복구)이라, 별도 브로드캐스트나
 * 에러 응답은 두지 않는다(옛 RallyController와 동일 구조).
 */
@Controller
class OffensiveController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
) {
    @MessageMapping("/offensive")
    fun offensive(@Payload cmd: SetOffensiveCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        gameLoop.submitOnRoom(binding.roomId) { world ->
            GameCore.setOffensive(world, binding.holderId, cmd.index)
        }
    }
}
