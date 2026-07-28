package com.madcamp.server.config

import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/**
 * REST(api 하위 경로) 전용 CORS. WS(/ws)는 WebSocketConfig.setAllowedOriginPatterns("*")로 이미
 * 별도 허용돼 있다 — Spring MVC CORS는 WS 핸드셰이크 설정을 공유하지 않아 REST용으로 따로 연다.
 * 개발 중 Vite dev 서버(다른 포트)에서 바로 호출해야 해서 WS와 동일하게 전체 허용(*)로 둔다.
 */
@Configuration
class CorsConfig : WebMvcConfigurer {
    override fun addCorsMappings(registry: CorsRegistry) {
        registry.addMapping("/api/**")
            .allowedOriginPatterns("*")
            .allowedMethods("GET", "POST")
    }
}
