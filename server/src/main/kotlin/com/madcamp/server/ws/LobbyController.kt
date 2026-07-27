package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.game.Member
import com.madcamp.server.game.Room
import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.session.SessionService
import com.madcamp.server.ws.dto.CreateRoomCommand
import com.madcamp.server.ws.dto.JoinRoomCommand
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 로비(다중 방) 엔드포인트 — 방 목록/생성/입장. 방 멤버십·상태는 GameLoop 단일 스레드에서만
 * mutate해 월드 무락 불변식을 지킨다(gameLoop.submitRoomTask). 진행 중(PLAYING) 방에 입장하면
 * 즉시 스폰(라이브 조인)하고 WELCOME을 보낸다. LOBBY 방은 대기 멤버십만.
 */
@Controller
class LobbyController(
    private val gameLoop: GameLoop,
    private val roomManager: RoomManager,
    private val connectionRegistry: ConnectionRegistry,
    private val sessionService: SessionService,
    private val configService: ConfigService,
    private val welcomeAssembler: WelcomeAssembler,
    private val broadcaster: RoomBroadcaster,
    private val messaging: SimpMessagingTemplate,
) {
    @MessageMapping("/lobby/list")
    fun list() {
        gameLoop.submitRoomTask { broadcaster.broadcastRoomList() }
    }

    @MessageMapping("/lobby/create")
    fun create(@Payload cmd: CreateRoomCommand, principal: Principal) {
        gameLoop.submitRoomTask {
            val openRooms = roomManager.list().count { it.id != RoomManager.DEFAULT_ROOM_ID }
            if (openRooms >= RoomManager.MAX_ROOMS) {
                broadcaster.broadcastRoomList() // 상한 초과 — 목록만 갱신(클라가 '가득 참' 인지)
                return@submitRoomTask
            }
            val name = cmd.name?.trim()?.takeUnless { it.isEmpty() }?.take(20) ?: "새 방"
            val room = roomManager.create(name)
            addMemberAndReply(room, principal, cmd.nickname, cmd.token)
        }
    }

    @MessageMapping("/lobby/join")
    fun join(@Payload cmd: JoinRoomCommand, principal: Principal) {
        gameLoop.submitRoomTask {
            // 재접속 우선: 토큰이 기억하는 방이 아직 있으면 그 방으로 복귀시킨다.
            val targetId = sessionService.roomOf(cmd.token)?.takeIf { roomManager.get(it) != null } ?: cmd.roomId
            val room = roomManager.get(targetId)
            if (room == null || room.id == RoomManager.DEFAULT_ROOM_ID) {
                broadcaster.broadcastRoomList() // 없는 방(또는 브리지 방) — 목록만 돌려줘 클라가 로비 유지
                return@submitRoomTask
            }
            val already = room.members.containsKey(principal.name)
            if (!already && room.members.size >= RoomManager.MAX_MEMBERS_PER_ROOM) {
                broadcaster.broadcastRoomList() // 정원 초과
                return@submitRoomTask
            }
            addMemberAndReply(room, principal, cmd.nickname, cmd.token)
        }
    }

    // 멤버 등록 + 입장 응답 + 브로드캐스트. (executor 스레드에서만 호출)
    private fun addMemberAndReply(room: Room, principal: Principal, nickname: String?, token: String?) {
        val name = nickname?.trim()?.takeUnless { it.isEmpty() }?.take(12) ?: "player"
        val member = room.members.getOrPut(principal.name) { Member(principal.name, name, token ?: "") }
        member.nickname = name

        val world = room.world
        if (room.state == RoomState.PLAYING && world != null) {
            // 라이브 조인: 진행 중 방에 바로 스폰(토큰 있으면 기존 holder 복구). WELCOME으로 스냅샷 전달.
            val (tok, session) = sessionService.joinOrRestore(room.id, world, configService.current, name, token)
            member.holderId = session.holderId
            member.token = tok
            connectionRegistry.bind(principal.name, room.id, session.holderId)
            messaging.convertAndSendToUser(
                principal.name,
                "/queue/welcome",
                welcomeAssembler.build(room.id, world, session.holderId, tok),
            )
        } else {
            if (token != null) member.token = token
            connectionRegistry.bind(principal.name, room.id, member.holderId) // 로비 대기(holderId=-1)
        }
        messaging.convertAndSendToUser(principal.name, "/queue/roomJoined", broadcaster.roomJoined(room))
        broadcaster.broadcastRoomState(room)
        broadcaster.broadcastRoomList()
    }
}
