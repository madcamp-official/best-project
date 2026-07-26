package com.madcamp.server.config

import org.springframework.stereotype.Service

/**
 * 현재 CONFIG를 들고 있는 단일 지점. GameLoop(단일 스레드)만 읽고,
 * AdminController가 STOMP/tick 스레드와 다른 스레드에서 갱신하므로 @Volatile로 가시성을 보장한다.
 */
@Service
class ConfigService {
    @Volatile
    final var current: GameConfig = GameConfig()
        private set

    fun replace(next: GameConfig) {
        current = next
    }
}
