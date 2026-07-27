package com.madcamp.server.auth

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

data class IdTokenRequest(val idToken: String = "")

/**
 * 구글 로그인 계정 REST 진입점. 게임 자체는 STOMP(WS)를 쓰지만, "내 프로필 보기" 같은 단발성
 * 조회는 WS 왕복(구독·큐)을 만들 것 없이 평범한 REST가 더 간단해서 별도로 뺐다.
 * idToken은 매 요청 바디로 받아 그때그때 검증한다(서버가 세션을 들고 있지 않음 — Firebase가 신원의 원본).
 */
@RestController
class AccountController(private val accountService: AccountService) {
    @PostMapping("/api/account/me")
    fun me(@RequestBody req: IdTokenRequest): ResponseEntity<AccountProfile> = try {
        ResponseEntity.ok(accountService.getProfile(req.idToken))
    } catch (e: GoogleAuthException) {
        ResponseEntity.status(401).build()
    }
}
