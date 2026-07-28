package com.madcamp.server.ws

import com.madcamp.server.domain.GameCore
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.ToggleAttackTargetCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 공격 큐 토글(C→S, /app/attack-queue). GameCore.toggleAttackTarget이 적·중립 + 내 영토 인접을
 * 검증해 큐에 넣거나 뺀다. 이후 GameLoop의 공격 큐 주기가 각 대상에 인접한 내 동들을 자동 출정시킨다.
 * 큐는 그 플레이어의 공격 흐름에만 영향을 주고 마커는 클라 로컬(WELCOME.attackQueue로 복구)이라,
 * 별도 브로드캐스트나 에러 응답은 두지 않는다(RallyController와 동일 취지).
 */
@Controller
class AttackQueueController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
) {
    @MessageMapping("/attack-queue")
    fun attackQueue(@Payload cmd: ToggleAttackTargetCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        gameLoop.submitOnRoom(binding.roomId) { world ->
            GameCore.toggleAttackTarget(world, binding.holderId, cmd.index)
        }
    }
}
