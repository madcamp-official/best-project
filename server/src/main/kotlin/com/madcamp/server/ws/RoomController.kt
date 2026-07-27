package com.madcamp.server.ws

import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.loop.GameLoop
import org.springframework.messaging.handler.annotation.MessageMapping
import org.springframework.stereotype.Controller
import java.security.Principal

/**
 * 방 나가기(다중 세션). 라운드 시작(start)·생명주기는 Phase 4에서 이 컨트롤러에 추가한다.
 * 멤버십 조작은 GameLoop 단일 스레드에서(월드 무락 불변식).
 */
@Controller
class RoomController(
    private val gameLoop: GameLoop,
    private val roomManager: RoomManager,
    private val connectionRegistry: ConnectionRegistry,
    private val broadcaster: RoomBroadcaster,
) {
    @MessageMapping("/room/leave")
    fun leave(principal: Principal) {
        val binding = connectionRegistry.bindingOf(principal.name) ?: return
        if (binding.roomId == GameLoop.DEFAULT_ROOM_ID) return // 브리지 방은 로비 대상 아님
        gameLoop.submitRoomTask {
            val room = roomManager.get(binding.roomId) ?: return@submitRoomTask
            room.members.remove(principal.name)
            connectionRegistry.unbind(principal.name)
            // 빈 방은 정리(단, PLAYING 중이면 유지 — 재접속·잔여 처리는 Phase 4).
            if (room.members.isEmpty() && room.state != RoomState.PLAYING) {
                roomManager.remove(room.id)
            } else {
                broadcaster.broadcastRoomState(room)
            }
            broadcaster.broadcastRoomList()
        }
    }
}
