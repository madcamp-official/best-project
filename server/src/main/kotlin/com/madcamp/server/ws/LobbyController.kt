package com.madcamp.server.ws

import com.madcamp.server.auth.AccountService
import com.madcamp.server.auth.GoogleAuthException
import com.madcamp.server.auth.PresenceRegistry
import com.madcamp.server.auth.ResolvedAccount
import com.madcamp.server.config.ConfigService
import com.madcamp.server.config.HolderIds
import com.madcamp.server.data.MapCatalog
import com.madcamp.server.domain.PlayerAi
import com.madcamp.server.domain.World
import com.madcamp.server.game.Member
import com.madcamp.server.game.Room
import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.loop.GameLoop
import com.madcamp.server.session.SessionService
import com.madcamp.server.ws.dto.CreateRoomCommand
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.JoinByCodeCommand
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
    private val accountService: AccountService,
    private val presenceRegistry: PresenceRegistry,
    private val messaging: SimpMessagingTemplate,
) {
    @MessageMapping("/lobby/list")
    fun list() {
        gameLoop.submitRoomTask { broadcaster.broadcastRoomList() }
    }

    @MessageMapping("/lobby/create")
    fun create(@Payload cmd: CreateRoomCommand, principal: Principal) {
        val resolved = resolveNicknameOrNotify(principal, cmd.nickname, cmd.idToken) ?: return
        gameLoop.submitRoomTask {
            val openRooms = roomManager.list().count { it.id != RoomManager.DEFAULT_ROOM_ID }
            if (openRooms >= RoomManager.MAX_ROOMS) {
                sendRoomError(principal, "ROOM_LIMIT", "방 개수가 가득 찼습니다 — 잠시 후 다시 시도하세요.")
                broadcaster.broadcastRoomList()
                return@submitRoomTask
            }
            val name = cmd.name?.trim()?.takeUnless { it.isEmpty() }?.take(20) ?: "새 방"
            val room = roomManager.create(name, cmd.mapId ?: MapCatalog.DEFAULT, cmd.private)
            room.hostClientId = clientIdOf(cmd.clientId, principal) // 생성자가 방장 — 시작 권한 보유
            addMemberAndReply(room, principal, resolved, cmd.token, cmd.clientId)
        }
    }

    /** 초대 코드로 비공개 방 입장 — 로비 목록엔 안 뜨지만 코드를 아는 사람은 바로 들어올 수 있다. */
    @MessageMapping("/lobby/joinByCode")
    fun joinByCode(@Payload cmd: JoinByCodeCommand, principal: Principal) {
        val resolved = resolveNicknameOrNotify(principal, cmd.nickname, cmd.idToken) ?: return
        gameLoop.submitRoomTask {
            val room = roomManager.findByJoinCode(cmd.code)
            if (room == null) {
                sendRoomError(principal, "ROOM_NOT_FOUND", "코드가 올바르지 않습니다 — 다시 확인해주세요.")
                return@submitRoomTask
            }
            val cid = clientIdOf(cmd.clientId, principal)
            val already = room.members.values.any { it.clientId == cid }
            if (!already && room.members.size >= RoomManager.MAX_MEMBERS_PER_ROOM) {
                sendRoomError(principal, "ROOM_FULL", "방 정원이 가득 찼습니다.")
                return@submitRoomTask
            }
            addMemberAndReply(room, principal, resolved, cmd.token, cmd.clientId)
        }
    }

    @MessageMapping("/lobby/join")
    fun join(@Payload cmd: JoinRoomCommand, principal: Principal) {
        val resolved = resolveNicknameOrNotify(principal, cmd.nickname, cmd.idToken) ?: return
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
            addMemberAndReply(room, principal, resolved, cmd.token, cmd.clientId)
        }
    }

    // 현재 실제 플레이어(사람+AI) 수 — 중립·(구)E 제외.
    private fun playerCount(world: World): Int =
        world.holders.values.count { it.id != HolderIds.NEUTRAL && it.id != HolderIds.ENV }

    // 구글 로그인(idToken) 검증은 네트워크 I/O가 있을 수 있어 GameLoop 스레드(submitRoomTask) 밖,
    // 즉 여기서 먼저 끝낸다 — GameLoop는 항상 로컬 연산만 도는 게 전제라 블로킹하면 전체 방 tick이 밀린다.
    // 실패하면 에러를 보내고 null을 돌려주며, 호출자는 그대로 return해 방 작업을 건너뛴다.
    private fun resolveNicknameOrNotify(principal: Principal, nickname: String?, idToken: String?): ResolvedAccount? =
        try {
            accountService.resolveNickname(nickname, idToken)
        } catch (e: GoogleAuthException) {
            sendRoomError(principal, "GOOGLE_LOGIN_FAILED", e.message ?: "구글 로그인에 실패했습니다.")
            null
        }

    // 영속 clientId(없으면 이번 연결 principal로 폴백 — clientId 미전송 클라·스모크테스트 호환).
    private fun clientIdOf(clientId: String?, principal: Principal): String =
        clientId?.takeUnless { it.isBlank() } ?: principal.name

    private fun sendRoomError(principal: Principal, code: String, message: String) {
        messaging.convertAndSendToUser(principal.name, "/queue/error", ErrorMessage(code, message, -1, -1))
    }

    // 멤버 등록 + 입장 응답 + 브로드캐스트. (executor 스레드에서만 호출)
    // resolved.nickname은 이미 확정된 닉네임(resolveNicknameOrNotify가 게스트 트림/구글 로그인 계정
    // 반영까지 끝냄). resolved.appUserId는 게스트면 null — 로그인 유저만 라운드 종료 시 전적이 쌓인다.
    private fun addMemberAndReply(room: Room, principal: Principal, resolved: ResolvedAccount, token: String?, clientId: String?) {
        val name = resolved.nickname
        val cid = clientIdOf(clientId, principal)
        // 재접속 유령 제거: 같은 clientId의 이전 principal 멤버가 남아 있으면(연결 해제 이벤트 지연) 지운다.
        // 이게 없으면 재접속 시 옛 principal이 방장 자리를 쥔 채 새 principal이 비방장 멤버로 붙는다.
        room.members.entries.filter { it.value.clientId == cid && it.key != principal.name }
            .forEach { room.members.remove(it.key); connectionRegistry.unbind(it.key) }
        val member = room.members.getOrPut(principal.name) { Member(principal.name, name, token ?: "", clientId = cid) }
        member.principalName = principal.name
        member.clientId = cid
        member.nickname = name
        member.appUserId = resolved.appUserId
        // 로그인 유저면 "지금 이 방에 있음"을 접속 현황에 반영 — 친구 목록의 따라가기·초대가 이걸 본다.
        resolved.appUserId?.let {
            presenceRegistry.online(principal.name, it, name)
            presenceRegistry.setRoom(principal.name, room.id, room.name)
        }

        val world = room.world
        if (room.state == RoomState.PLAYING && world != null) {
            // 라이브 조인: 진행 중 방에 바로 스폰(같은 방·같은 라운드의 토큰이면 기존 holder 복구).
            val config = configService.current
            val (tok, session) = sessionService.joinOrRestore(room.id, world, config, name, token)
            member.holderId = session.holderId
            member.token = tok
            connectionRegistry.bind(principal.name, room.id, session.holderId)
            // 새 사람이 들어와 정원(AI_FILL_TARGET)을 넘겼으면 가장 약한 AI를 빼 자리를 내준다.
            // (재접속으로 기존 holder를 복구한 경우엔 인원이 안 늘어 아무 것도 빠지지 않는다.)
            while (playerCount(world) > config.aiFillTarget) {
                if (!PlayerAi.removeWeakest(world, config, System.currentTimeMillis())) break
            }
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
