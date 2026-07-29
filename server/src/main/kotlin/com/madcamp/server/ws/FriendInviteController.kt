package com.madcamp.server.ws

import com.madcamp.server.auth.AccountService
import com.madcamp.server.auth.FriendStatus
import com.madcamp.server.auth.FriendshipRepository
import com.madcamp.server.auth.GoogleAuthException
import com.madcamp.server.auth.PresenceRegistry
import com.madcamp.server.game.RoomManager
import com.madcamp.server.ws.dto.ErrorMessage
import com.madcamp.server.ws.dto.FriendPresence
import com.madcamp.server.ws.dto.FriendPresenceMessage
import com.madcamp.server.ws.dto.HelloCommand
import com.madcamp.server.ws.dto.InviteCommand
import com.madcamp.server.ws.dto.InviteMessage
import org.slf4j.LoggerFactory
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 친구 접속 현황과 초대 푸시. 친구 목록에서 "초대"를 누르면 상대 화면에 바로 알림이 뜨고, 상대는
 * 클릭 한 번으로 그 방에 들어온다 — 초대 코드를 복사해 카톡으로 보내는 단계를 없앤다.
 *
 * 계정 기능이라 REST(FriendController)와 짝을 이루지만, "상대 화면으로 밀어넣기"는 서버가 먼저
 * 말을 걸어야 해서 REST로는 안 된다. 그래서 이쪽만 STOMP로 둔다.
 */
@Controller
class FriendInviteController(
    private val accountService: AccountService,
    private val friendshipRepository: FriendshipRepository,
    private val presenceRegistry: PresenceRegistry,
    private val roomManager: RoomManager,
    private val connectionRegistry: ConnectionRegistry,
    private val messaging: SimpMessagingTemplate,
) {
    private val log = LoggerFactory.getLogger(FriendInviteController::class.java)

    /**
     * "나 접속했어, 내 친구들 어디 있어?" — 로비에 들어올 때와 친구 패널을 열 때 부른다.
     * 이 호출이 곧 접속 등록이라(로그인 유저는 로비에 가만히 있어도 초대를 받을 수 있어야 한다),
     * 응답으로 친구들의 현재 위치를 돌려준다.
     */
    @MessageMapping("/friends/hello")
    fun hello(@Payload cmd: HelloCommand, principal: Principal) {
        val me = authOrNotify(principal, cmd.idToken) ?: return
        presenceRegistry.online(principal.name, me.appUserId, me.nickname)
        // 이미 방에 들어와 있는 채로 호출됐다면(새로고침 등) 현재 방을 반영해준다.
        connectionRegistry.bindingOf(principal.name)?.let { b ->
            val room = roomManager.get(b.roomId)
            if (room != null && room.id != RoomManager.DEFAULT_ROOM_ID) {
                presenceRegistry.setRoom(principal.name, room.id, room.name)
            }
        }
        sendPresence(principal, me.appUserId)
    }

    /** 친구를 지금 내가 있는 방으로 부른다. 상대가 접속 중이 아니면 알려준다(코드 공유로 폴백). */
    @MessageMapping("/friends/invite")
    fun invite(@Payload cmd: InviteCommand, principal: Principal) {
        val me = authOrNotify(principal, cmd.idToken) ?: return
        if (!areFriends(me.appUserId, cmd.targetAppUserId)) {
            return sendError(principal, "NOT_FRIEND", "친구가 아닌 사용자에게는 초대를 보낼 수 없습니다.")
        }
        val binding = connectionRegistry.bindingOf(principal.name)
            ?: return sendError(principal, "NOT_IN_ROOM", "방에 들어간 뒤에 초대할 수 있습니다.")
        val room = roomManager.get(binding.roomId)
            ?: return sendError(principal, "ROOM_NOT_FOUND", "방을 찾을 수 없습니다.")

        val target = presenceRegistry.of(cmd.targetAppUserId)
            ?: return sendError(principal, "FRIEND_OFFLINE", "상대가 접속 중이 아닙니다 — 초대 코드를 대신 공유해보세요.")

        messaging.convertAndSendToUser(
            target.principalName,
            "/queue/invite",
            InviteMessage(
                fromNickname = me.nickname,
                roomId = room.id,
                roomName = room.name,
                joinCode = room.joinCode.takeUnless { it.isEmpty() },
            ),
        )
        log.info("초대 전송: {} → {} (room={})", me.nickname, target.nickname, room.id)
        // 보낸 쪽에도 최신 접속 현황을 돌려줘 "초대함" 상태가 바로 반영되게 한다.
        sendPresence(principal, me.appUserId)
    }

    // 내 친구(ACCEPTED)들 중 지금 접속해 있는 사람 목록을 개인 큐로 보낸다.
    private fun sendPresence(principal: Principal, myAppUserId: Long) {
        val friendIds = friendshipRepository.findAllInvolving(myAppUserId)
            .filter { it.status == FriendStatus.ACCEPTED }
            .map { if (it.requesterId == myAppUserId) it.addresseeId else it.requesterId }
        val online = presenceRegistry.anyOf(friendIds).map {
            FriendPresence(it.appUserId, it.nickname, it.roomId, it.roomName)
        }
        messaging.convertAndSendToUser(principal.name, "/queue/friendPresence", FriendPresenceMessage(online))
    }

    private fun areFriends(a: Long, b: Long): Boolean =
        friendshipRepository.findByRequesterIdAndAddresseeId(a, b)?.status == FriendStatus.ACCEPTED ||
            friendshipRepository.findByRequesterIdAndAddresseeId(b, a)?.status == FriendStatus.ACCEPTED

    // 구글 토큰 검증은 네트워크 I/O가 있을 수 있어 GameLoop 밖(이 스레드)에서 끝낸다.
    private fun authOrNotify(principal: Principal, idToken: String?): ResolvedMe? = try {
        val token = idToken?.takeUnless { it.isBlank() } ?: return null // 게스트는 친구 기능 대상이 아님
        val user = accountService.findOrCreateAppUser(token)
        ResolvedMe(user.id, user.nickname)
    } catch (e: GoogleAuthException) {
        log.warn("친구 초대 인증 거부: {}", e.message)
        sendError(principal, "GOOGLE_LOGIN_FAILED", "로그인 확인에 실패했습니다 — 다시 로그인해주세요.")
        null
    }

    private fun sendError(principal: Principal, code: String, message: String) {
        messaging.convertAndSendToUser(principal.name, "/queue/error", ErrorMessage(code, message, -1, -1))
    }

    private data class ResolvedMe(val appUserId: Long, val nickname: String)
}
