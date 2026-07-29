package com.madcamp.server.auth

import org.springframework.stereotype.Service
import java.time.Instant

/** LobbyController/JoinController가 닉네임 확정 후 쓰는 결과. appUserId는 게스트면 null. */
data class ResolvedAccount(val nickname: String, val appUserId: Long?)

/** REST 계정·친구 API가 돌려주는 계정 요약. */
data class AccountProfile(
    val appUserId: Long,
    val nickname: String,
    val level: Int,
    val wins: Int,
    val gamesPlayed: Int,
)

/**
 * 로비/방 입장(LobbyController)·레거시 JOIN(JoinController)이 닉네임을 확정하기 직전에 호출하는
 * 단일 통합 지점. idToken이 없으면 게스트 그대로(닉네임 트림/길이 제한만) — 기존 동작 100% 유지.
 * idToken이 있으면 검증 후 AppUser(H2 영속 계정)를 조회/생성하고 그 계정 기준으로 닉네임을 정한다.
 * REST 컨트롤러(AccountController/FriendController)도 idToken 검증에 이 서비스를 재사용한다.
 */
@Service
class AccountService(
    private val firebaseAuthService: FirebaseAuthService,
    private val appUserRepository: AppUserRepository,
) {
    // 레벨 = 3승마다 +1(1레벨 시작). 저장하지 않고 매번 승수에서 파생한다(README §6 계급 파생 방식과 동일 철학).
    fun levelOf(wins: Int): Int = 1 + wins / 3

    /** 실패(구글 로그인 미설정·토큰 무효) 시 GoogleAuthException 전파 — 호출자가 ErrorMessage로 변환할 것. */
    fun resolveNickname(nickname: String?, idToken: String?): ResolvedAccount {
        val requested = nickname?.trim()?.takeUnless { it.isEmpty() }?.take(12)
        if (idToken == null) return ResolvedAccount(requested ?: "player", null)

        val appUser = findOrCreateAppUser(idToken)

        // 우선순위: 이번에 명시적으로 보낸 닉네임 > 구글 표시 이름 > 계정에 저장된 지난 닉네임 > 최후 fallback.
        val identity = firebaseAuthService.verifyIdToken(idToken) // 위 findOrCreateAppUser에서 이미 검증됐지만 name은 여기서 다시 필요
        val resolved = requested
            ?: identity.name?.trim()?.takeUnless { it.isEmpty() }?.take(12)
            ?: appUser.nickname.takeUnless { it.isBlank() }
            ?: "player${identity.uid.take(6)}"

        appUser.nickname = resolved
        appUser.lastLoginAt = Instant.now()
        appUserRepository.save(appUser)
        return ResolvedAccount(resolved, appUser.id)
    }

    /** idToken 검증 후 AppUser를 찾거나(없으면) 새로 만들어 저장까지 한다. 실패 시 GoogleAuthException. */
    fun findOrCreateAppUser(idToken: String): AppUser {
        val identity = firebaseAuthService.verifyIdToken(idToken)
        return appUserRepository.findByGoogleUid(identity.uid) ?: appUserRepository.save(
            AppUser(googleUid = identity.uid, email = identity.email, nickname = identity.name?.take(12) ?: "player"),
        )
    }

    fun profileOf(appUser: AppUser): AccountProfile =
        AccountProfile(appUser.id, appUser.nickname, levelOf(appUser.wins), appUser.wins, appUser.gamesPlayed)

    /** idToken으로 프로필을 조회한다(REST 진입점). 실패 시 GoogleAuthException. */
    fun getProfile(idToken: String): AccountProfile = profileOf(findOrCreateAppUser(idToken))

    /**
     * 닉네임을 계정에 즉시 저장한다(REST 진입점). 여기 저장하면 친구 목록·검색·접속 현황이
     * 전부 이 값을 읽으므로 화면마다 따로 갱신할 필요가 없다. 호출자가 트림·길이 제한을 마친
     * 값을 넘긴다고 가정한다. 실패 시 GoogleAuthException.
     */
    fun changeNickname(idToken: String, nickname: String): AccountProfile {
        val appUser = findOrCreateAppUser(idToken)
        appUser.nickname = nickname
        appUser.lastLoginAt = Instant.now()
        return profileOf(appUserRepository.save(appUser))
    }
}
