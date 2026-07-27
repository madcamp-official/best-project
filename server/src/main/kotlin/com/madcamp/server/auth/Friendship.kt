package com.madcamp.server.auth

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant

enum class FriendStatus { PENDING, ACCEPTED }

/**
 * 친구 관계 한 방향(요청자→상대). 수락 전엔 PENDING, 수락하면 ACCEPTED로 상태만 바꾼다(행 하나로
 * 양방향 다 표현 — FriendController가 조회 시 requester/addressee 양쪽에서 나를 찾는다).
 */
@Entity
@Table(name = "friendships")
data class Friendship(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long = 0,

    @Column(nullable = false)
    val requesterId: Long = 0,

    @Column(nullable = false)
    val addresseeId: Long = 0,

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    var status: FriendStatus = FriendStatus.PENDING,

    @Column(nullable = false)
    val createdAt: Instant = Instant.now(),
)

interface FriendshipRepository : JpaRepository<Friendship, Long> {
    fun findByRequesterIdAndAddresseeId(requesterId: Long, addresseeId: Long): Friendship?

    @Query("select f from Friendship f where f.requesterId = :userId or f.addresseeId = :userId")
    fun findAllInvolving(@Param("userId") userId: Long): List<Friendship>
}
