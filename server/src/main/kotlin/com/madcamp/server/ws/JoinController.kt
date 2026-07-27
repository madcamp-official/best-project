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
 * 레거시/개발 호환 JOIN(C→S, /app/join) → WELCOME(S→C, /user/queue/welcome). 기본 방(default)에
 * 붙는다. 정식 다중 방 진입은 /app/lobby/(list·create·join)(LobbyController)이며, 이 엔드포인트는
 * /app/join·/topic/world를 쓰는 스모크테스트 도구(server/tools/smoke-test) 호환용으로 유지한다.
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
            welcomeAssembler.build(RoomManager.DEFAULT_ROOM_ID, world, session.holderId, token, roundEndsAtMs = 0L)
        } ?: return
        messagingTemplate.convertAndSendToUser(principal.name, "/queue/welcome", welcome)
    }
}
