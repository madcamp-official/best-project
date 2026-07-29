package com.madcamp.server.auth

import org.slf4j.LoggerFactory
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

data class IdTokenRequest(val idToken: String = "")

/** 닉네임 변경(POST /api/account/nickname). 빈 값이면 400 — 계정 닉네임이 사라지면 안 된다. */
data class NicknameRequest(val idToken: String = "", val nickname: String = "")

/**
 * 구글 로그인 계정 REST 진입점. 게임 자체는 STOMP(WS)를 쓰지만, "내 프로필 보기" 같은 단발성
 * 조회는 WS 왕복(구독·큐)을 만들 것 없이 평범한 REST가 더 간단해서 별도로 뺐다.
 * idToken은 매 요청 바디로 받아 그때그때 검증한다(서버가 세션을 들고 있지 않음 — Firebase가 신원의 원본).
 */
@RestController
class AccountController(private val accountService: AccountService) {
    private val log = LoggerFactory.getLogger(AccountController::class.java)

    @PostMapping("/api/account/me")
    fun me(@RequestBody req: IdTokenRequest): ResponseEntity<AccountProfile> = try {
        ResponseEntity.ok(accountService.getProfile(req.idToken))
    } catch (e: GoogleAuthException) {
        // 401을 조용히 돌려주면 "로그인은 됐는데 프로필만 안 뜨는" 상황의 원인을 서버에서 알 수 없다.
        // 토큰 자체는 절대 남기지 않고(자격 증명) 실패 사유만 남긴다.
        log.warn("프로필 조회 실패 — idToken 검증 거부: {}", e.message)
        ResponseEntity.status(401).build()
    }

    /**
     * 닉네임 변경. 지금까지는 방에 입장할 때만(resolveNickname) 계정에 반영돼서, 로비에서 이름만
     * 고치고 방에 안 들어가면 아무 데도 안 남았다 — 친구 목록엔 계속 옛 이름이 보였다.
     * 여기서 바로 저장해 프로필·친구 목록·접속 현황이 즉시 같은 이름을 쓰게 한다.
     */
    @PostMapping("/api/account/nickname")
    fun updateNickname(@RequestBody req: NicknameRequest): ResponseEntity<AccountProfile> = try {
        val trimmed = req.nickname.trim().take(12)
        if (trimmed.isEmpty()) ResponseEntity.badRequest().build()
        else ResponseEntity.ok(accountService.changeNickname(req.idToken, trimmed))
    } catch (e: GoogleAuthException) {
        log.warn("닉네임 변경 실패 — idToken 검증 거부: {}", e.message)
        ResponseEntity.status(401).build()
    }
}
