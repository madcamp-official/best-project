package com.madcamp.server.auth

import org.springframework.stereotype.Service
import java.time.Instant

/**
 * 로비/방 입장(LobbyController)·레거시 JOIN(JoinController)이 닉네임을 확정하기 직전에 호출하는
 * 단일 통합 지점. idToken이 없으면 게스트 그대로(닉네임 트림/길이 제한만) — 기존 동작 100% 유지.
 * idToken이 있으면 검증 후 AppUser(H2 영속 계정)를 조회/생성하고 그 계정 기준으로 닉네임을 정한다.
 */
@Service
class AccountService(
    private val firebaseAuthService: FirebaseAuthService,
    private val appUserRepository: AppUserRepository,
) {
    /** 실패(구글 로그인 미설정·토큰 무효) 시 GoogleAuthException 전파 — 호출자가 ErrorMessage로 변환할 것. */
    fun resolveNickname(nickname: String?, idToken: String?): String {
        val requested = nickname?.trim()?.takeUnless { it.isEmpty() }?.take(12)
        if (idToken == null) return requested ?: "player"

        val identity = firebaseAuthService.verifyIdToken(idToken)
        val appUser = appUserRepository.findByGoogleUid(identity.uid)
            ?: AppUser(googleUid = identity.uid, email = identity.email)

        // 우선순위: 이번에 명시적으로 보낸 닉네임 > 구글 표시 이름 > 계정에 저장된 지난 닉네임 > 최후 fallback.
        val resolved = requested
            ?: identity.name?.trim()?.takeUnless { it.isEmpty() }?.take(12)
            ?: appUser.nickname.takeUnless { it.isBlank() }
            ?: "player${identity.uid.take(6)}"

        appUser.nickname = resolved
        appUser.lastLoginAt = Instant.now()
        appUserRepository.save(appUser)
        return resolved
    }
}
