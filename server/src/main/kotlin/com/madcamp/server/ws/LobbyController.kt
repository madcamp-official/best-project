package com.madcamp.server.ws

import com.madcamp.server.config.ConfigService
import com.madcamp.server.data.MapCatalog
import com.madcamp.server.game.Member
import com.madcamp.server.game.Room
import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.session.SessionService
import com.madcamp.server.ws.dto.CreateRoomCommand
import com.madcamp.server.ws.dto.ErrorMessage
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
                sendRoomError(principal, "ROOM_LIMIT", "방 개수가 가득 찼습니다 — 잠시 후 다시 시도하세요.")
                broadcaster.broadcastRoomList()
                return@submitRoomTask
            }
            val name = cmd.name?.trim()?.takeUnless { it.isEmpty() }?.take(20) ?: "새 방"
            val room = roomManager.create(name, cmd.mapId ?: MapCatalog.DEFAULT)
            room.hostClientId = clientIdOf(cmd.clientId, principal) // 생성자가 방장 — 시작 권한 보유
            addMemberAndReply(room, principal, cmd.nickname, cmd.token, cmd.clientId)
        }
    }

    @MessageMapping("/lobby/join")
    fun join(@Payload cmd: JoinRoomCommand, principal: Principal) {
        gameLoop.submitRoomTask {
            // 명시적으로 고른 방(roomId)이 항상 우선. 비어 있을 때만(새로고침 뒤 자동 복구 등)
            // 토큰이 기억하는 방으로 폴백한다 — 안 그러면 "방 A를 나가고 방 B를 클릭했는데
            // 토큰이 방 A를 기억해 A로 끌려가는" 하이재킹이 생긴다.
            val targetId = cmd.roomId.takeUnless { it.isBlank() } ?: sessionService.roomOf(cmd.token)
            val room = targetId?.let { roomManager.get(it) }
            if (room == null || room.id == RoomManager.DEFAULT_ROOM_ID) {
                sendRoomError(principal, "ROOM_NOT_FOUND", "방을 찾을 수 없습니다 — 이미 사라졌을 수 있어요.")
                broadcaster.broadcastRoomList() // 클라가 로비 목록을 최신으로 유지
                return@submitRoomTask
            }
            val cid = clientIdOf(cmd.clientId, principal)
            val already = room.members.values.any { it.clientId == cid }
            if (!already && room.members.size >= RoomManager.MAX_MEMBERS_PER_ROOM) {
                sendRoomError(principal, "ROOM_FULL", "방 정원이 가득 찼습니다.")
                broadcaster.broadcastRoomList()
                return@submitRoomTask
            }
            addMemberAndReply(room, principal, cmd.nickname, cmd.token, cmd.clientId)
        }
    }

    // 영속 clientId(없으면 이번 연결 principal로 폴백 — clientId 미전송 클라·스모크테스트 호환).
    private fun clientIdOf(clientId: String?, principal: Principal): String =
        clientId?.takeUnless { it.isBlank() } ?: principal.name

    private fun sendRoomError(principal: Principal, code: String, message: String) {
        messaging.convertAndSendToUser(principal.name, "/queue/error", ErrorMessage(code, message, -1, -1))
    }

    // 멤버 등록 + 입장 응답 + 브로드캐스트. (executor 스레드에서만 호출)
    private fun addMemberAndReply(room: Room, principal: Principal, nickname: String?, token: String?, clientId: String?) {
        val name = nickname?.trim()?.takeUnless { it.isEmpty() }?.take(12) ?: "player"
        val cid = clientIdOf(clientId, principal)
        // 재접속 유령 제거: 같은 clientId의 이전 principal 멤버가 남아 있으면(연결 해제 이벤트 지연) 지운다.
        // 이게 없으면 재접속 시 옛 principal이 방장 자리를 쥔 채 새 principal이 비방장 멤버로 붙는다.
        room.members.entries.filter { it.value.clientId == cid && it.key != principal.name }
            .forEach { room.members.remove(it.key); connectionRegistry.unbind(it.key) }
        val member = room.members.getOrPut(principal.name) { Member(principal.name, name, token ?: "", clientId = cid) }
        member.principalName = principal.name
        member.clientId = cid
        member.nickname = name

        val world = room.world
        if (room.state == RoomState.PLAYING && world != null) {
            // 라이브 조인: 진행 중 방에 바로 스폰(같은 방·같은 라운드의 토큰이면 기존 holder 복구).
            val config = configService.current
            val (tok, session) = sessionService.joinOrRestore(room.id, world, config, name, token)
            member.holderId = session.holderId
            member.token = tok
            connectionRegistry.bind(principal.name, room.id, session.holderId)
            messaging.convertAndSendToUser(
                principal.name,
                "/queue/welcome",
                welcomeAssembler.build(
                    room.id, room.mapId, world, session.holderId, tok,
                    roundEndsAtMs = room.roundStartMs + config.roundDurationSec * 1000L,
                ),
            )
        } else {
            if (token != null) member.token = token
            connectionRegistry.bind(principal.name, room.id, member.holderId) // 로비 대기(holderId=-1)
        }
        messaging.convertAndSendToUser(principal.name, "/queue/roomJoined", broadcaster.roomJoined(room, cid))
        broadcaster.broadcastRoomState(room)
        broadcaster.broadcastRoomList()
    }
}
