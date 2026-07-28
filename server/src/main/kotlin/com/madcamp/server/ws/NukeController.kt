package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.World
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.LaunchNukeCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal
import kotlin.math.cos

/**
 * 전술핵 발사(C→S, /app/nuke). 울릉도·제주의 사일로 동을 소유한 플레이어만 발사할 수 있고,
 * 반경은 서버 config(일반 미사일 × NUKE_RADIUS_MULT)가 정한다 — 클라 radius는 신뢰하지 않는다.
 * 사일로별 쿨다운(NUKE_COOLDOWN_SEC)은 GameCore.launchNuke가 검증하며, 성공은 다음 tick의
 * DELTA(cells + nukeReadyAtMs + missileImpacts)로 전원에 퍼진다. (구조는 MissileController와 동일.)
 */
@Controller
class NukeController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
    private val configService: ConfigService,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/nuke")
    fun nuke(@Payload cmd: LaunchNukeCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return

        gameLoop.submitOnRoom(binding.roomId) { world ->
            val config = configService.current
            // 전술핵 반경은 서버가 결정(일반 미사일 × 배수). hit centroid 근접 검증은 미사일과 동일.
            val radius = config.missileRadiusDeg * config.nukeRadiusMult
            val lim = radius + config.missileHitMarginDeg
            val valid =
                if (cmd.center.size < 2) emptyList()
                else cmd.hits.filter { withinRadius(world, it, cmd.center, lim) }

            val res = GameCore.launchNuke(world, config, binding.holderId, valid, System.currentTimeMillis())
            if (!res.ok) {
                messagingTemplate.convertAndSendToUser(
                    principal.name,
                    "/queue/error",
                    ErrorMessage("NO_NUKE", res.reason, -1, -1),
                )
            } else {
                // 소모되는 미사일이 없으므로 missileRemove는 건드리지 않는다(사일로는 영구).
                // 착탄 동 전부(이미 중립이던 동 포함)를 실어 보낸다 — 폭발 연출 경로는 미사일과 공유.
                world.pendingMissileImpacts.addAll(res.neutralized)
                // 착탄 동 위를 지나던 이동 유닛도 전부 소멸(광역이라 여러 유닛이 걸릴 수 있다).
                world.pendingRemovedOrders.addAll(GameCore.destroyOrdersOnCells(world, res.neutralized))
            }
        }
    }

    // lim은 지도 전역 여유(radius+margin), 여기에 그 셀 자체의 크기(radiusDeg)를 더해 큰 셀
    // 가장자리를 클릭해도 centroid가 멀다는 이유로 거부되지 않게 한다(MissileController와 동일).
    private fun withinRadius(world: World, i: Int, center: List<Double>, lim: Double): Boolean {
        if (i < 0 || i >= world.n) return false
        val c = world.meta[i].centroid
        val cosLat = cos(center[1] * Math.PI / 180.0)
        val dx = (c[0] - center[0]) * cosLat
        val dy = c[1] - center[1]
        val effLim = lim + world.radiusDeg[i]
        return dx * dx + dy * dy <= effLim * effLim
    }
}
