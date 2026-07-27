package com.madcamp.server.ws

import com.madcamp.server.domain.LeaderboardRow
import com.madcamp.server.game.Room
import com.madcamp.server.game.RoomManager
import com.madcamp.server.ws.dto.MemberInfo
import com.madcamp.server.ws.dto.RoomInfo
import com.madcamp.server.ws.dto.RoomJoinedMessage
import com.madcamp.server.ws.dto.RoomListMessage
import com.madcamp.server.ws.dto.RoomStateMessage
import com.madcamp.server.ws.dto.RoundEndMessage
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Component

/**
 * 로비/방 관련 브로드캐스트를 한곳에 모은다(토픽 문자열·메시지 조립 중복 제거).
 * 멤버 목록을 훑는 메서드는 GameLoop 단일 스레드(방 조작 스레드)에서 호출해야 안전하다.
 */
@Component
class RoomBroadcaster(
    private val messaging: SimpMessagingTemplate,
    private val roomManager: RoomManager,
) {
    /** 공개 방 목록(브리지 기본 방·비공개 방 제외)을 /topic/rooms로 브로드캐스트. 비공개 방은
     * joinCode를 아는 사람만 /lobby/joinByCode로 들어올 수 있어 여기 실릴 필요가 없다. */
    fun broadcastRoomList() {
        val rooms = roomManager.list()
            .filter { it.id != RoomManager.DEFAULT_ROOM_ID && !it.private }
            .map { RoomInfo(it.id, it.name, it.state, it.members.size, RoomManager.MAX_MEMBERS_PER_ROOM) }
        messaging.convertAndSend(ROOMS_TOPIC, RoomListMessage(rooms))
    }

    /** 특정 방의 상태·멤버 변경을 /topic/room/{id}/state로 브로드캐스트. */
    fun broadcastRoomState(room: Room) {
        messaging.convertAndSend(stateTopic(room.id), RoomStateMessage(room.id, room.state, memberInfos(room)))
    }

    /** 라운드 종료 결과를 /topic/room/{id}/state로 브로드캐스트(같은 채널로 상태 흐름 일원화). */
    fun broadcastRoundEnd(
        room: Room,
        reason: String,
        winnerHolderId: Int,
        winnerName: String?,
        leaderboard: List<LeaderboardRow>,
    ) {
        messaging.convertAndSend(
            stateTopic(room.id),
            RoundEndMessage(room.id, reason, winnerHolderId, winnerName, leaderboard),
        )
    }

    fun roomJoined(room: Room, forClientId: String) =
        RoomJoinedMessage(
            room.id, room.name, room.state, memberInfos(room),
            youAreHost = forClientId == room.hostClientId,
            joinCode = room.joinCode.takeUnless { it.isEmpty() },
        )

    /** 방장 승계 등으로 특정 멤버의 방장 여부가 바뀌었을 때 개인 통지(roomJoined 재전송). */
    fun notifyRoomJoined(room: Room, principalName: String, clientId: String) {
        messaging.convertAndSendToUser(principalName, "/queue/roomJoined", roomJoined(room, clientId))
    }

    private fun memberInfos(room: Room) =
        room.members.values.map { MemberInfo(it.nickname, it.holderId, it.ready, it.clientId == room.hostClientId) }

    companion object {
        const val ROOMS_TOPIC = "/topic/rooms"
        fun stateTopic(roomId: String) = "/topic/room/$roomId/state"
    }
}
