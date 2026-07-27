package com.madcamp.server.auth

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

data class FriendCandidate(val appUserId: Long, val nickname: String, val level: Int)
data class PendingRequest(val requestId: Long, val appUserId: Long, val nickname: String)
data class FriendsListResponse(
    val friends: List<FriendCandidate>,
    val incoming: List<PendingRequest>, // 나에게 온 요청(내가 수락/거절)
    val outgoing: List<PendingRequest>, // 내가 보낸 요청(상대 응답 대기)
)
data class SearchRequest(val idToken: String = "", val query: String = "")
data class FriendRequestBody(val idToken: String = "", val targetAppUserId: Long = 0)
data class RespondRequestBody(val idToken: String = "", val requestId: Long = 0, val accept: Boolean = false)
data class SimpleResult(val ok: Boolean, val message: String = "")

/**
 * 친구 REST 엔드포인트. 게임 세션(WS)과 독립적 — 로비 화면 어디서든 호출 가능하게 REST로 뺐다.
 * idToken을 매 요청 바디로 받아 그때그때 신원을 확인한다(서버 세션 없음, Firebase가 신원 원본).
 */
@RestController
class FriendController(
    private val accountService: AccountService,
    private val appUserRepository: AppUserRepository,
    private val friendshipRepository: FriendshipRepository,
) {
    @PostMapping("/api/friends/search")
    fun search(@RequestBody req: SearchRequest): ResponseEntity<List<FriendCandidate>> {
        val me = auth(req.idToken) ?: return ResponseEntity.status(401).build()
        val query = req.query.trim()
        if (query.isEmpty()) return ResponseEntity.ok(emptyList())
        val results = appUserRepository.findByNicknameContainingIgnoreCase(query)
            .filter { it.id != me.id }
            .take(20)
            .map { FriendCandidate(it.id, it.nickname, accountService.levelOf(it.wins)) }
        return ResponseEntity.ok(results)
    }

    @PostMapping("/api/friends/request")
    fun request(@RequestBody req: FriendRequestBody): ResponseEntity<SimpleResult> {
        val me = auth(req.idToken) ?: return ResponseEntity.status(401).build()
        if (req.targetAppUserId == me.id) return ResponseEntity.ok(SimpleResult(false, "자기 자신은 추가할 수 없습니다."))
        appUserRepository.findById(req.targetAppUserId).orElse(null)
            ?: return ResponseEntity.ok(SimpleResult(false, "존재하지 않는 사용자입니다."))

        val forward = friendshipRepository.findByRequesterIdAndAddresseeId(me.id, req.targetAppUserId)
        val backward = friendshipRepository.findByRequesterIdAndAddresseeId(req.targetAppUserId, me.id)
        return when {
            forward?.status == FriendStatus.ACCEPTED || backward?.status == FriendStatus.ACCEPTED ->
                ResponseEntity.ok(SimpleResult(false, "이미 친구입니다."))
            forward != null -> ResponseEntity.ok(SimpleResult(false, "이미 요청을 보냈습니다."))
            backward != null -> {
                // 상대가 이미 나에게 요청해둔 상태 — 바로 수락 처리(중복 요청 대신 자연스럽게 매칭).
                backward.status = FriendStatus.ACCEPTED
                friendshipRepository.save(backward)
                ResponseEntity.ok(SimpleResult(true, "상대가 보낸 요청을 수락했습니다."))
            }
            else -> {
                friendshipRepository.save(Friendship(requesterId = me.id, addresseeId = req.targetAppUserId))
                ResponseEntity.ok(SimpleResult(true, "친구 요청을 보냈습니다."))
            }
        }
    }

    @PostMapping("/api/friends/respond")
    fun respond(@RequestBody req: RespondRequestBody): ResponseEntity<SimpleResult> {
        val me = auth(req.idToken) ?: return ResponseEntity.status(401).build()
        val friendship = friendshipRepository.findById(req.requestId).orElse(null)
            ?: return ResponseEntity.ok(SimpleResult(false, "요청을 찾을 수 없습니다."))
        if (friendship.addresseeId != me.id) return ResponseEntity.status(403).build()
        if (req.accept) {
            friendship.status = FriendStatus.ACCEPTED
            friendshipRepository.save(friendship)
            return ResponseEntity.ok(SimpleResult(true, "친구가 되었습니다."))
        }
        friendshipRepository.delete(friendship)
        return ResponseEntity.ok(SimpleResult(true, "요청을 거절했습니다."))
    }

    @PostMapping("/api/friends/list")
    fun list(@RequestBody req: SearchRequest): ResponseEntity<FriendsListResponse> {
        val me = auth(req.idToken) ?: return ResponseEntity.status(401).build()
        val all = friendshipRepository.findAllInvolving(me.id)

        fun otherOf(f: Friendship) = if (f.requesterId == me.id) f.addresseeId else f.requesterId
        fun nicknameOf(id: Long) = appUserRepository.findById(id).orElse(null)?.nickname ?: "(탈퇴한 사용자)"
        fun levelOf(id: Long) = accountService.levelOf(appUserRepository.findById(id).orElse(null)?.wins ?: 0)

        val friends = all.filter { it.status == FriendStatus.ACCEPTED }
            .map { FriendCandidate(otherOf(it), nicknameOf(otherOf(it)), levelOf(otherOf(it))) }
        val incoming = all.filter { it.status == FriendStatus.PENDING && it.addresseeId == me.id }
            .map { PendingRequest(it.id, it.requesterId, nicknameOf(it.requesterId)) }
        val outgoing = all.filter { it.status == FriendStatus.PENDING && it.requesterId == me.id }
            .map { PendingRequest(it.id, it.addresseeId, nicknameOf(it.addresseeId)) }

        return ResponseEntity.ok(FriendsListResponse(friends, incoming, outgoing))
    }

    private fun auth(idToken: String): AppUser? = try {
        accountService.findOrCreateAppUser(idToken)
    } catch (e: GoogleAuthException) {
        null
    }
}
