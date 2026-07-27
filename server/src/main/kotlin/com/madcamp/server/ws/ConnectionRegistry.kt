package com.madcamp.server.ws

import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/** STOMP Principal.name(커넥션별 UUID)이 참가 중인 방과 그 방에서의 holderId. */
data class RoomBinding(val roomId: String, val holderId: Int)

/**
 * STOMP Principal.name → 참가 중인 방·holderId 바인딩. 액션 컨트롤러는 이걸로 어느 방의 월드에
 * 명령을 보낼지 해석한다. World와 무관해 어느 스레드에서나 안전(ConcurrentHashMap).
 */
@Component
class ConnectionRegistry {
    private val bindingByPrincipal = ConcurrentHashMap<String, RoomBinding>()

    fun bind(principalName: String, roomId: String, holderId: Int) {
        bindingByPrincipal[principalName] = RoomBinding(roomId, holderId)
    }

    fun bindingOf(principalName: String): RoomBinding? = bindingByPrincipal[principalName]

    fun unbind(principalName: String) {
        bindingByPrincipal.remove(principalName)
    }
}
