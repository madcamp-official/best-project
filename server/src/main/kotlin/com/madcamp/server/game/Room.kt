package com.madcamp.server.game

import com.madcamp.server.domain.World

/** 방 생명주기 상태. LOBBY(대기)에서 시작 → PLAYING(라운드 진행) → ENDED(결과) → 다시 LOBBY. */
enum class RoomState { LOBBY, PLAYING, ENDED }

/**
 * 방(세션) 하나 = 독립된 라운드. World와 방별 tick accumulator를 함께 들고 있어, 단일 게임
 * 루프 스레드가 PLAYING 방들을 각자의 시계로 순회 tick한다(web 단일 월드 → 다중 방 전환).
 *
 * 스레드 규약: world/state/members/accumulator 등 모든 필드는 GameLoop의 단일 executor
 * 스레드에서만 mutate한다(월드 무락 불변식 유지). RoomManager의 맵 구조만 동시성 안전.
 */
class Room(
    val id: String,
    var name: String,
) {
    var state: RoomState = RoomState.LOBBY
    var world: World? = null // LOBBY 동안 null, 라운드 시작 시 생성
    var roundStartMs: Long = 0L // PLAYING 시작 벽시계(ms) — 제한 시간 판정용
    var winnerHolderId: Int = -1 // 직전 라운드 승자(-1=미정)
    // 방장(principal.name). 생성자가 방장이 되고, 이탈 시 남은 멤버 중 가장 오래된 사람에게 승계.
    // 게임 시작 권한은 방장에게만 있다(나머지는 준비 토글).
    var hostPrincipal: String = ""

    // 방 멤버(principal.name → Member). 라운드 사이에도 유지 — "방에서 대기 후 재시작".
    val members: LinkedHashMap<String, Member> = LinkedHashMap()

    // 방별 tick accumulator(단일 월드 시절 GameLoop 인스턴스 필드였던 것). 라운드 시작 시 리셋.
    var lastTickNanos: Long = 0L
    var tickCount: Long = 0L
    var missileAccumSec: Double = 0.0
    var supplyAccumSec: Double = 0.0
    var lastEnclosedKey: String = "" // 직전 브로드캐스트의 포위 동 집합 키 — 바뀔 때만 enclosed 전송
    val rng: java.util.Random = java.util.Random()
}

/** 방 참가자. token은 재접속 복구용, holderId는 라운드 중 배정(-1=미배정/로비). */
data class Member(
    val principalName: String,
    var nickname: String,
    var token: String,
    var holderId: Int = -1,
    var ready: Boolean = false, // 대기실 준비 상태(방장 제외 전원 준비 시 시작 가능). 라운드 종료 시 리셋.
)
