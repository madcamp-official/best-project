package com.madcamp.server.ws

import com.madcamp.server.domain.GameCore
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.SetRallyCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * B2 집결지 지정/해제(C→S, /app/rally). GameCore.setRally가 소유를 검증하고 저장하며, 이후 GameLoop의
 * 보급 주기가 후방 병력을 이 동으로 자동 전진시킨다. 집결지는 그 플레이어의 보급 흐름에만 영향을 주고
 * 마커는 클라 로컬(WELCOME.rally로 복구)이라, 별도 브로드캐스트나 에러 응답은 두지 않는다.
 */
@Controller
class RallyController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
) {
    @MessageMapping("/rally")
    fun rally(@Payload cmd: SetRallyCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        gameLoop.submitOnRoom(binding.roomId) { world ->
            GameCore.setRally(world, binding.holderId, cmd.index)
        }
    }
}
