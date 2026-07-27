package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.game.RoomManager
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.session.SessionService
import com.madcamp.server.ws.dto.JoinMessage
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * api-spec.md §2.1~§2.2 — 레거시 JOIN(C→S) → WELCOME(S→C, /user/queue/welcome). 과도기 브리지로
 * 기본 방(default)에 붙인다. 다중 방 정식 진입은 /app/lobby/(list·create·join)(LobbyController). Phase 7에서 제거 예정.
 */
@Controller
class JoinController(
    private val gameLoop: GameLoop,
    private val sessionService: SessionService,
    private val configService: ConfigService,
    private val connectionRegistry: ConnectionRegistry,
    private val welcomeAssembler: WelcomeAssembler,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/join")
    fun join(@Payload msg: JoinMessage, principal: Principal) {
        val welcome = gameLoop.runOnRoom(RoomManager.DEFAULT_ROOM_ID) { world ->
            val config = configService.current
            val (token, session) = sessionService.joinOrRestore(RoomManager.DEFAULT_ROOM_ID, world, config, msg.nickname, msg.token)
            connectionRegistry.bind(principal.name, RoomManager.DEFAULT_ROOM_ID, session.holderId)
            welcomeAssembler.build(RoomManager.DEFAULT_ROOM_ID, world, session.holderId, token)
        } ?: return
        messagingTemplate.convertAndSendToUser(principal.name, "/queue/welcome", welcome)
    }
}
