package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.World
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.LaunchMissileCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal
import kotlin.math.cos

/**
 * api-spec 확장 — 미사일 발사(C→S, /app/missile). 폴리곤을 가진 클라가 원에 걸친 동(hits)을
 * 계산해 보내면, 서버는 반경 상한과 centroid 근접을 검증한 뒤 미사일 1개를 소모해 hits를
 * 중립화한다. 성공은 다음 tick의 DELTA(cells + missileRemove)로 전원에 퍼지고, 실패(미사일
 * 없음)만 요청자에게 ERROR로 돌려준다. (검증 순서/취지는 SortieController와 동일.)
 */
@Controller
class MissileController(
    private val gameLoop: GameLoop,
    private val connectionRegistry: ConnectionRegistry,
    private val configService: ConfigService,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    @MessageMapping("/missile")
    fun missile(@Payload cmd: LaunchMissileCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return

        gameLoop.submitOnRoom(binding.roomId) { world ->
            val config = configService.current
            // 클라가 보낸 반경은 신뢰하지 않고 상한으로 클램프하고, 각 hit 동 centroid가
            // 원 중심에서 (반경 + 여유) 안인지 검증한다 — 폴리곤이 없는 서버의 근사 검증.
            val radius = cmd.radius.coerceIn(0.0, config.missileMaxRadiusDeg)
            val lim = radius + config.missileHitMarginDeg
            val valid =
                if (cmd.center.size < 2) emptyList()
                else cmd.hits.filter { withinRadius(world, it, cmd.center, lim) }

            val res = GameCore.launchMissile(world, binding.holderId, valid, System.currentTimeMillis())
            if (!res.ok) {
                messagingTemplate.convertAndSendToUser(
                    principal.name,
                    "/queue/error",
                    ErrorMessage("NO_MISSILE", res.reason, -1, -1),
                )
            } else {
                world.pendingMissileRemove.add(res.removed) // 중립화된 동은 dirty로 cells에 실린다
                // 착탄 동 전부(이미 중립이던 동 포함)를 실어 보낸다 — 소유권 변화가 없어도 폭발이 뜨게.
                world.pendingMissileImpacts.addAll(res.neutralized)
            }
        }
    }

    // lim은 지도 전역 여유(radius+margin), 여기에 그 셀 자체의 크기(radiusDeg)를 더해 큰 셀
    // (러시아·시군구 등) 가장자리를 클릭해도 centroid가 멀다는 이유로 거부되지 않게 한다.
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
