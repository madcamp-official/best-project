package com.madcamp.server.auth

import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/**
 * 지금 접속해 있는 로그인 유저 한 명. roomId가 null이면 로비에 있는 것.
 * roomName은 친구 목록에 "○○방에 있음"으로 보여주기 위한 표시용 사본이다.
 */
data class Presence(
    val principalName: String,
    val appUserId: Long,
    val nickname: String,
    val roomId: String? = null,
    val roomName: String? = null,
)

/**
 * 로그인 유저의 접속 현황(appUserId ↔ STOMP principal). 친구 초대를 "그 사람의 화면으로" 밀어
 * 넣으려면 계정 id로 현재 연결을 찾을 수 있어야 해서 둔다.
 *
 * 한 계정이 여러 탭으로 붙으면 마지막 연결이 이긴다 — 초대 알림이 여러 화면에 흩뿌려지는 것보다
 * 가장 최근에 보고 있는 화면 하나로 가는 편이 낫다. World와 무관해 어느 스레드에서나 안전.
 */
@Component
class PresenceRegistry {
    private val byAppUser = ConcurrentHashMap<Long, Presence>()
    private val appUserByPrincipal = ConcurrentHashMap<String, Long>()

    /** 로그인 유저가 접속했음을 기록(로비 진입·방 입장 등 idToken이 확인된 시점마다 호출). */
    fun online(principalName: String, appUserId: Long, nickname: String) {
        // 같은 계정의 옛 연결이 다른 principal로 남아 있으면 매핑을 정리한다(탭 이동/재접속).
        byAppUser[appUserId]?.let { if (it.principalName != principalName) appUserByPrincipal.remove(it.principalName) }
        val prev = byAppUser[appUserId]
        appUserByPrincipal[principalName] = appUserId
        byAppUser[appUserId] = Presence(
            principalName = principalName,
            appUserId = appUserId,
            nickname = nickname,
            // 같은 연결이면 방 정보를 유지한다(로비 폴링이 방 정보를 지우지 않게).
            roomId = if (prev?.principalName == principalName) prev.roomId else null,
            roomName = if (prev?.principalName == principalName) prev.roomName else null,
        )
    }

    /** 방에 들어가거나(roomId 지정) 로비로 나왔을 때(null) 위치를 갱신한다. */
    fun setRoom(principalName: String, roomId: String?, roomName: String?) {
        val appUserId = appUserByPrincipal[principalName] ?: return
        val cur = byAppUser[appUserId] ?: return
        if (cur.principalName != principalName) return // 더 최근 연결이 주인 — 옛 탭의 이동은 무시
        byAppUser[appUserId] = cur.copy(roomId = roomId, roomName = roomName)
    }

    /** 연결이 끊긴 principal을 접속 목록에서 지운다. */
    fun offline(principalName: String) {
        val appUserId = appUserByPrincipal.remove(principalName) ?: return
        val cur = byAppUser[appUserId] ?: return
        if (cur.principalName == principalName) byAppUser.remove(appUserId) // 더 최근 연결이면 남겨둔다
    }

    fun of(appUserId: Long): Presence? = byAppUser[appUserId]

    fun anyOf(appUserIds: Collection<Long>): List<Presence> = appUserIds.mapNotNull { byAppUser[it] }
}
