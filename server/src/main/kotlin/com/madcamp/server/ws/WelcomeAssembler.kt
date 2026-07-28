package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.data.MapCatalog
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
    fun build(roomId: String, mapId: String, world: World, holderId: Int, token: String, roundEndsAtMs: Long): WelcomeMessage {
        // 지도별 거리 상수 오버라이드(MapCatalog.applyProfile)를 실어 보낸다 — 클라가 이 값을
        // RUNTIME_CONFIG로 받아써야 시군구의 미사일/공수 반경이 서버 판정과 어긋나지 않는다.
        val config = MapCatalog.applyProfile(configService.current, mapId)
        val holder = world.holders.getValue(holderId)
        val nowMs = System.currentTimeMillis()
        return WelcomeMessage(
            roomId = roomId,
            mapId = mapId,
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
            offensive = world.offensive[holderId],
            shields = (0 until 256).mapNotNull { hid ->
                val until = world.shieldUntil[hid]
                if (until > nowMs) ShieldInfo(hid, until) else null
            },
            nukeReadyAtMs = world.nukeReadyAt.toList(),
        )
    }
}
