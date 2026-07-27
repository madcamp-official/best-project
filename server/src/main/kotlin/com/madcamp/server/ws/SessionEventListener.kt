package com.madcamp.server.ws

import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.loop.GameLoop
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component
import org.springframework.web.socket.messaging.SessionDisconnectEvent

/**
 * WebSocket 연결 해제 정리. 방 멤버에서 제거하고 바인딩을 해제한다. PLAYING 방의 holder/영토는
 * 유지해(토큰 재접속 복구), 빈 LOBBY/ENDED 방만 닫는다. 브리지 기본 방은 대상 아님.
 * 멤버십 조작은 executor 스레드에서(월드 무락 불변식).
 */
@Component
class SessionEventListener(
    private val gameLoop: GameLoop,
    private val roomManager: RoomManager,
    private val connectionRegistry: ConnectionRegistry,
    private val broadcaster: RoomBroadcaster,
) {
    @EventListener
    fun onDisconnect(event: SessionDisconnectEvent) {
        val principalName = event.user?.name ?: return
        val binding = connectionRegistry.bindingOf(principalName) ?: return
        connectionRegistry.unbind(principalName)
        if (binding.roomId == RoomManager.DEFAULT_ROOM_ID) return // 브리지 방은 멤버 목록을 안 쓴다
        gameLoop.submitRoomTask {
            val room = roomManager.get(binding.roomId) ?: return@submitRoomTask
            room.members.remove(principalName)
            if (room.members.isEmpty() && room.state != RoomState.PLAYING) {
                roomManager.remove(room.id)
            } else {
                broadcaster.broadcastRoomState(room)
            }
            broadcaster.broadcastRoomList()
        }
    }
}
