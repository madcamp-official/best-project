package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.game.Room
import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.session.SessionService
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.SetReadyCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 방 시작/나가기(다중 세션). start는 LOBBY→PLAYING: 프레시 월드 생성·멤버 스폰·WELCOME.
 * 종료(51%/시간)와 LOBBY 복귀는 GameLoop.tickRoom이 처리한다. 멤버십·월드 조작은 전부
 * GameLoop 단일 스레드에서(월드 무락 불변식).
 */
@Controller
class RoomController(
    private val gameLoop: GameLoop,
    private val roomManager: RoomManager,
    private val connectionRegistry: ConnectionRegistry,
    private val sessionService: SessionService,
    private val configService: ConfigService,
    private val welcomeAssembler: WelcomeAssembler,
    private val broadcaster: RoomBroadcaster,
    private val messaging: SimpMessagingTemplate,
) {
    @MessageMapping("/room/start")
    fun start(principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        if (binding.roomId == RoomManager.DEFAULT_ROOM_ID) return
        gameLoop.submitRoomTask {
            val room = roomManager.get(binding.roomId) ?: return@submitRoomTask
            if (room.state == RoomState.PLAYING || room.members.isEmpty()) return@submitRoomTask
            // 시작 권한은 방장(clientId 기준)에게만. 그 외에는 전원(방장 제외) 준비 완료가 조건.
            val me = room.members[principal.name]
            if (me == null || me.clientId != room.hostClientId) {
                sendError(principal, "NOT_HOST", "방장만 게임을 시작할 수 있습니다.")
                return@submitRoomTask
            }
            if (room.members.values.any { it.clientId != room.hostClientId && !it.ready }) {
                sendError(principal, "NOT_READY", "모든 플레이어가 준비를 완료해야 시작할 수 있습니다.")
                return@submitRoomTask
            }
            if (roomManager.playingCount() >= RoomManager.MAX_PLAYING_ROOMS) {
                // 동시 진행 방 상한 — 시작한 사람에게 이유를 알려준다(조용히 무시하면 버튼이 "고장"처럼 보임).
                sendError(principal, "ROOM_LIMIT", "동시에 진행 중인 게임이 가득 찼습니다 — 잠시 후 다시 시도하세요.")
                return@submitRoomTask
            }
            startRound(room)
        }
    }

    /** 대기실 준비 토글(방장 아닌 멤버). 상태 변경은 /topic/room/{id}/state로 전원에 퍼진다. */
    @MessageMapping("/room/ready")
    fun ready(@Payload cmd: SetReadyCommand, principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        if (binding.roomId == RoomManager.DEFAULT_ROOM_ID) return
        gameLoop.submitRoomTask {
            val room = roomManager.get(binding.roomId) ?: return@submitRoomTask
            if (room.state == RoomState.PLAYING) return@submitRoomTask // 진행 중엔 무의미
            val member = room.members[principal.name] ?: return@submitRoomTask
            member.ready = cmd.ready
            broadcaster.broadcastRoomState(room)
        }
    }

    private fun sendError(principal: Principal, code: String, message: String) {
        messaging.convertAndSendToUser(principal.name, "/queue/error", ErrorMessage(code, message, -1, -1))
    }

    @MessageMapping("/room/leave")
    fun leave(principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        if (binding.roomId == RoomManager.DEFAULT_ROOM_ID) return // 브리지 방은 로비 대상 아님
        gameLoop.submitRoomTask {
            val room = roomManager.get(binding.roomId) ?: return@submitRoomTask
            val leaving = room.members.remove(principal.name)
            connectionRegistry.unbind(principal.name)
            // 빈 방은 정리(단, PLAYING 중이면 유지 — 재접속·잔여 처리).
            if (room.members.isEmpty() && room.state != RoomState.PLAYING) {
                roomManager.remove(room.id)
            } else {
                // 방장이 나갔으면 남은 멤버 중 가장 오래된 사람에게 승계하고 개인 통지한다.
                if (leaving != null && leaving.clientId == room.hostClientId && room.members.isNotEmpty()) {
                    val newHost = room.members.values.first()
                    room.hostClientId = newHost.clientId
                    broadcaster.notifyRoomJoined(room, newHost.principalName, newHost.clientId)
                }
                broadcaster.broadcastRoomState(room)
            }
            broadcaster.broadcastRoomList()
        }
    }

    // 라운드 시작: 프레시 월드 생성 → 멤버 스폰 → accumulator·타이머 리셋 → PLAYING → 각 멤버 WELCOME.
    // (executor 스레드에서만 호출)
    private fun startRound(room: Room) {
        val config = configService.current
        val world = gameLoop.createFreshWorld()
        room.world = world
        for (member in room.members.values) {
            // 새 라운드 = 새 월드라 항상 새 holder를 배정한다. 지난 라운드 토큰 세션은 스테일이므로
            // 지워 누적을 막는다(새 토큰은 WELCOME으로 내려가 클라 localStorage를 교체한다).
            sessionService.remove(member.token)
            val (tok, session) = sessionService.joinOrRestore(room.id, world, config, member.nickname, null)
            member.holderId = session.holderId
            member.token = tok
            connectionRegistry.bind(member.principalName, room.id, session.holderId)
        }
        room.tickCount = 0
        room.missileAccumSec = 0.0
        room.offensiveAccumSec = 0.0
        room.lastEnclosedKey = ""
        room.lastTickNanos = System.nanoTime()
        room.roundStartMs = System.currentTimeMillis()
        room.winnerHolderId = -1
        room.state = RoomState.PLAYING
        val roundEndsAtMs = room.roundStartMs + config.roundDurationSec * 1000L
        for (member in room.members.values) {
            messaging.convertAndSendToUser(
                member.principalName,
                "/queue/welcome",
                welcomeAssembler.build(room.id, world, member.holderId, member.token, roundEndsAtMs),
            )
        }
        broadcaster.broadcastRoomState(room)
        broadcaster.broadcastRoomList()
    }
}
