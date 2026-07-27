package com.madcamp.server.auth

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import java.time.Instant

/**
 * 구글 로그인(feat/google-login) 계정. 게임 월드(방마다 라운드 단위로 새로 만들어지는 World,
 * server/data/의 스냅샷)와는 완전히 별개 저장소(H2 파일 DB) — 여긴 "이 구글 계정의 닉네임/이메일"만
 * 기억한다. holderId는 라운드마다·방마다 새로 배정되는 값이라(RoomController.startRound) 계정에
 * 묶어 영속할 대상이 아니다 — AccountService가 로그인 시 닉네임을 채워주는 용도로만 쓴다.
 */
@Entity
@Table(name = "app_users")
data class AppUser(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long = 0,

    @Column(nullable = false, unique = true)
    val googleUid: String = "",

    @Column(nullable = false)
    val email: String = "",

    @Column(nullable = false)
    var nickname: String = "",

    @Column(nullable = false)
    val createdAt: Instant = Instant.now(),

    @Column(nullable = false)
    var lastLoginAt: Instant = Instant.now(),
)

interface AppUserRepository : JpaRepository<AppUser, Long> {
    fun findByGoogleUid(googleUid: String): AppUser?
}
