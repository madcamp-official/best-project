package com.madcamp.server.ws

import com.madcamp.server.domain.GameCore
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.SetAggroCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 자동 공세 스탠스 on/off(C→S, /app/aggro). GameCore.setAggressive가 플레이어(중립·E 아님)만 저장하며,
 * 이후 GameLoop의 공세 주기가 켜진 플레이어의 최전선 동을 이길 만한 인접 적·중립으로 자동 출정시킨다.
 * 토글 상태는 그 플레이어에게만 영향을 주고 마커는 클라 로컬(WELCOME.aggressive로 복구)이라,
 * 별도 브로드캐스트나 에러 응답은 두지 않는다(RallyController와 동일 구조).
 */
@Controller
class AggroController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
) {
    @MessageMapping("/aggro")
    fun aggro(@Payload cmd: SetAggroCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        gameLoop.submitOnRoom(binding.roomId) { world ->
            GameCore.setAggressive(world, binding.holderId, cmd.on)
        }
    }
}
