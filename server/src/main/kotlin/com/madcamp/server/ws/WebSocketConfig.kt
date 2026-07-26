package com.madcamp.server.ws

import org.springframework.context.annotation.Configuration
import org.springframework.http.server.ServerHttpRequest
import org.springframework.messaging.simp.config.MessageBrokerRegistry
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker
import org.springframework.web.socket.config.annotation.StompEndpointRegistry
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer
import org.springframework.web.socket.server.support.DefaultHandshakeHandler
import java.security.Principal
import java.util.UUID

// api-spec.md §1 — 단일 엔드포인트 /ws, /topic 이하(브로드캐스트) · /app 이하(수신) ·
// /user/queue 이하(개인 응답). 로그인이 없으므로 핸드셰이크 시점에 커넥션마다
// 무작위 Principal을 발급해 STOMP user destination(convertAndSendToUser)을 쓸 수 있게 한다.
@Configuration
@EnableWebSocketMessageBroker
class WebSocketConfig : WebSocketMessageBrokerConfigurer {

    override fun registerStompEndpoints(registry: StompEndpointRegistry) {
        registry.addEndpoint("/ws")
            .setAllowedOriginPatterns("*")
            .setHandshakeHandler(AnonymousPrincipalHandshakeHandler())
            .withSockJS()
        // SockJS 폴백 없이 순수 WebSocket만 쓰고 싶으면 위 withSockJS()를 제거하고
        // 같은 addEndpoint("/ws") 라인만 남긴다(plan.md Day 1 결정 사항).
    }

    override fun configureMessageBroker(registry: MessageBrokerRegistry) {
        registry.enableSimpleBroker("/topic", "/queue")
        registry.setApplicationDestinationPrefixes("/app")
        registry.setUserDestinationPrefix("/user")
    }
}

private class AnonymousPrincipalHandshakeHandler : DefaultHandshakeHandler() {
    override fun determineUser(
        request: ServerHttpRequest,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Principal = StompPrincipal(UUID.randomUUID().toString())
}

data class StompPrincipal(private val id: String) : Principal {
    override fun getName(): String = id
}
