package com.madcamp.server.ws

import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/** STOMP Principal.name(커넥션별 UUID) → holderId. World와 무관해 어느 스레드에서나 안전. */
@Component
class ConnectionRegistry {
    private val holderIdByPrincipal = ConcurrentHashMap<String, Int>()

    fun bind(principalName: String, holderId: Int) {
        holderIdByPrincipal[principalName] = holderId
    }

    fun holderIdOf(principalName: String): Int? = holderIdByPrincipal[principalName]

    fun unbind(principalName: String) {
        holderIdByPrincipal.remove(principalName)
    }
}
