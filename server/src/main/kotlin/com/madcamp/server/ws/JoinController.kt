package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.ShieldInfo
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.session.SessionService
import com.madcamp.server.ws.dto.JoinMessage
import com.madcamp.server.ws.dto.WelcomeMessage
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/** api-spec.md §2.1~§2.2 — JOIN(C→S) → WELCOME(S→C, /user/queue/welcome). */
@Controller
class JoinController(
    private val gameLoop: GameLoop,
    private val sessionService: SessionService,
    private val configService: ConfigService,
    private val connectionRegistry: ConnectionRegistry,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/join")
    fun join(@Payload msg: JoinMessage, principal: Principal) {
        val welcome = gameLoop.runOnLoop { world ->
            val config = configService.current
            val (token, session) = sessionService.joinOrRestore(world, config, msg.nickname, msg.token)
            connectionRegistry.bind(principal.name, session.holderId)
            val holder = world.holders.getValue(session.holderId)
            val nowMs = System.currentTimeMillis()

            WelcomeMessage(
                holderId = session.holderId,
                token = token,
                paletteIdx = holder.paletteIdx,
                config = config,
                serverTimeMs = nowMs,
                meta = world.meta.toList(),
                neighborIndex = world.neighborIndex.toList(),
                ownerId = world.ownerId.copyOf(),
                troops = world.troops.copyOf(),
                troopCap = world.troopCap.copyOf(),
                holders = world.holders.values.toList(),
                orders = world.orders.toList(),
                missiles = (0 until world.n).filter { world.missile[it] },
                rally = world.rally[session.holderId],
                shields = (0 until 256).mapNotNull { hid ->
                    val until = world.shieldUntil[hid]
                    if (until > nowMs) ShieldInfo(hid, until) else null
                },
            )
        }
        messagingTemplate.convertAndSendToUser(principal.name, "/queue/welcome", welcome)
    }
}
