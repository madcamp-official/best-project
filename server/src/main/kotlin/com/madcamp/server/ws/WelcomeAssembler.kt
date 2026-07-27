package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.ShieldInfo
import com.madcamp.server.domain.World
import com.madcamp.server.ws.dto.WelcomeMessage
import org.springframework.stereotype.Component

/**
 * WELCOME(전체 스냅샷) 페이로드 조립. JOIN(브리지)·라운드 시작·라이브 조인이 공유한다.
 * World 배열을 copyOf로 복사해 담으므로 GameLoop 단일 스레드에서 호출해야 일관된 스냅샷이 나온다.
 */
@Component
class WelcomeAssembler(private val configService: ConfigService) {
    fun build(roomId: String, world: World, holderId: Int, token: String, roundEndsAtMs: Long): WelcomeMessage {
        val config = configService.current
        val holder = world.holders.getValue(holderId)
        val nowMs = System.currentTimeMillis()
        return WelcomeMessage(
            roomId = roomId,
            roundEndsAtMs = roundEndsAtMs,
            holderId = holderId,
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
            rally = world.rally[holderId],
            shields = (0 until 256).mapNotNull { hid ->
                val until = world.shieldUntil[hid]
                if (until > nowMs) ShieldInfo(hid, until) else null
            },
        )
    }
}
