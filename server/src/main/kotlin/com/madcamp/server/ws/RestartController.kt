package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.GameCore
import com.madcamp.server.loop.GameLoop
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 궤멸(소유 동 0개) 재시작 요청(C→S, /app/restart). 페이로드 없음 — 요청자 holderId만으로
 * 충분하다. GameCore.respawnPlayer가 실제로 소유 동이 0개인지 재검증하므로(아직 살아있으면
 * 조용히 무시), 별도 에러 응답은 두지 않는다. 성공하면 새 동이 dirty로 잡혀 다음 DELTA로 퍼진다.
 */
@Controller
class RestartController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
    private val configService: ConfigService,
) {
    @MessageMapping("/restart")
    fun restart(principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        val config = configService.current
        gameLoop.submitOnRoom(binding.roomId) { world ->
            GameCore.respawnPlayer(world, config, binding.holderId, System.currentTimeMillis())
        }
    }
}
