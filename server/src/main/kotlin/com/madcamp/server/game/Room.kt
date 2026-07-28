package com.madcamp.server.game

import com.madcamp.server.data.MapCatalog
import com.madcamp.server.domain.LeaderboardRow
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
    var mapId: String = MapCatalog.DEFAULT,
) {
    var state: RoomState = RoomState.LOBBY
    var world: World? = null // LOBBY 동안 null, 라운드 시작 시 생성
    var roundStartMs: Long = 0L // PLAYING 시작 벽시계(ms) — 제한 시간 판정용
    var winnerHolderId: Int = -1 // 직전 라운드 승자(-1=미정)
    // 방장의 clientId(연결마다 바뀌는 principal이 아니라 클라 localStorage의 영속 id). 생성자가 방장이
    // 되고, 이탈 시 남은 멤버 중 가장 오래된 사람에게 승계. 시작 권한은 방장에게만(나머지는 준비 토글).
    // clientId로 두어야 재접속(새 principal)해도 방장 자리가 유지된다.
    var hostClientId: String = ""

    // 비공개 방(친구 초대) — true면 로비 공개 목록(/topic/rooms)에서 빠지고, joinCode를 아는 사람만
    // /lobby/joinByCode로 입장할 수 있다. RoomManager.create가 생성 시점에 정한다(이후 안 바뀜).
    var private: Boolean = false
    var joinCode: String = "" // private=false면 빈 문자열

    // 방 멤버(principal.name → Member). 라운드 사이에도 유지 — "방에서 대기 후 재시작".
    val members: LinkedHashMap<String, Member> = LinkedHashMap()

    // 방별 tick accumulator(단일 월드 시절 GameLoop 인스턴스 필드였던 것). 라운드 시작 시 리셋.
    var lastTickNanos: Long = 0L
    var tickCount: Long = 0L
    var missileAccumSec: Double = 0.0
    var supplyAccumSec: Double = 0.0 // 보급 흐름 주기 누산기
    var attackAccumSec: Double = 0.0 // 공격 큐 주기 누산기
    var aiActAccumSec: Double = 0.0 // AI 플레이어 행동 주기 누산기
    // 직전 브로드캐스트 시점의 enclosedBy 복사본 — 달라진 tick에만 enclosed를 싣는다.
    // (예전엔 매 tick 포위 목록을 문자열 키로 만들어 비교했는데, 그 방식은 tick마다 리스트·문자열을
    //  할당한다. IntArray 원본 비교는 안 바뀐 tick에 할당이 전혀 없다.)
    var lastEnclosedBy: IntArray = IntArray(0)
    // 직전에 전송한 리더보드 — 내용이 같으면 스킵한다(강제 재전송 주기 제외, GameLoop 참조).
    var lastLeaderboard: List<LeaderboardRow>? = null
    var lastEnvCells: Int = -1
    var lastLeaderboardTick: Long = 0L
    val rng: java.util.Random = java.util.Random()
}

/**
 * 방 참가자. principalName은 현재 연결(재접속 시 갱신됨), clientId는 영속 신원(방장·중복 판정용),
 * token은 재접속 복구용, holderId는 라운드 중 배정(-1=미배정/로비).
 */
data class Member(
    var principalName: String,
    var nickname: String,
    var token: String,
    var clientId: String = "",
    var holderId: Int = -1,
    var ready: Boolean = false, // 대기실 준비 상태(방장 제외 전원 준비 시 시작 가능). 라운드 종료 시 리셋.
    // 구글 로그인(feat/google-login) 계정 id — 게스트면 null. GameLoop.endRound가 라운드 우승/참여
    // 전적을 이 계정에 쌓는다(AppUser.wins/gamesPlayed).
    var appUserId: Long? = null,
)
