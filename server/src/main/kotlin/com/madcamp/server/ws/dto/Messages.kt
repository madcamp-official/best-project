package com.madcamp.server.ws.dto

import com.fasterxml.jackson.annotation.JsonInclude
import com.madcamp.server.config.GameConfig
import com.madcamp.server.game.RoomState
import com.madcamp.server.domain.DongStaticMeta
import com.madcamp.server.domain.Holder
import com.madcamp.server.domain.LeaderboardRow
import com.madcamp.server.domain.LogEvent
import com.madcamp.server.domain.Order
import com.madcamp.server.domain.ShieldInfo

// docs/api-spec.md §2 그대로 대응하는 STOMP 페이로드. 필드 하나하나가 문서의 표와 1:1.

data class JoinMessage(val nickname: String? = null, val token: String? = null)

data class WelcomeMessage(
    val roomId: String, // 이 스냅샷이 속한 방(다중 세션). 클라가 룸 스코프 토픽 구독에 쓴다.
    val mapId: String, // 이 방이 쓰는 지도(MapCatalog). 클라가 이 값으로 어느 geojson/names를 로드할지 정한다.
    val roundEndsAtMs: Long, // 라운드 제한 시각(서버 epoch ms). 0=제한 없음(브리지 기본 방)
    val holderId: Int,
    val token: String,
    val paletteIdx: Int,
    val config: GameConfig,
    val serverTimeMs: Long,
    val meta: List<DongStaticMeta>,
    val neighborIndex: List<IntArray>,
    val ownerId: IntArray,
    val troops: IntArray,
    val troopCap: IntArray,
    val holders: List<Holder>,
    val orders: List<Order>,
    val missiles: List<Int>, // 미사일이 얹힌 동 admIndex 목록
    val offensive: Int, // 이 플레이어의 공세 목표 admIndex(-1=없음). 재접속 복구용.
    val shields: List<ShieldInfo>, // 지금 활성 상태인 방어막 전체 스냅샷(만료분 제외)
    // 전술핵 사일로별 재발사 가능 시각(NUKE_SILO_CODES 순서, serverTimeMs와 같은 시간축).
    // 사일로 위치는 정적 데이터에서 파생되므로 보내지 않는다(클라가 initNukeState로 계산).
    val nukeReadyAtMs: List<Long>,
)

// ratio: 플레이어가 UI 슬라이더로 정한 이번 출정 병력 비율(0~1). 생략/비정상값이면
// 서버가 CONFIG.SORTIE_RATIO로 대체한다(web/src/net/protocol.ts §2.3과 동일 계약).
data class SortieCommand(val from: Int, val to: Int, val ratio: Double? = null)

// B1 경로 자동 출정(C→S, /app/march). to는 from과 인접하지 않아도 되며, 서버가 내 영토를 따라
// 최단 경로를 찾아 연쇄 출정을 발주한다. web/src/net/protocol.ts MarchCommand과 동일 계약.
data class MarchCommand(val from: Int, val to: Int, val ratio: Double? = null)

// 드래그 쓸기(C→S, /app/sortie-multi). 한 출발지(from)에서 여러 인접 목표(targets)로 병력을 균등
// 분할해 동시 출정한다. web/src/net/protocol.ts MultiSortieCommand과 동일 계약.
data class MultiSortieCommand(val from: Int = -1, val targets: List<Int> = emptyList(), val ratio: Double? = null)

// 미사일 발사(C→S, /app/missile). center=[lng,lat], radius=반경(도), hits=원에 겹치는 동
// admIndex(폴리곤을 가진 클라가 계산). 서버가 반경/근접을 검증하고 미사일 1개를 소모해 적용.
data class LaunchMissileCommand(
    val center: List<Double> = emptyList(),
    val radius: Double = 0.0,
    val hits: List<Int> = emptyList(),
)

// 공세 목표 지정/해제(C→S, /app/offensive). index = 적·중립 admIndex, -1이면 해제.
data class SetOffensiveCommand(val index: Int = -1)

// 전술핵 발사(C→S, /app/nuke). 사일로(울릉도·제주) 소유자만. hits = 전술핵 반경(일반 미사일의
// NUKE_RADIUS_MULT배) 원에 겹치는 동 admIndex(클라 계산). 서버가 소유·쿨다운·근접을 검증한다.
data class LaunchNukeCommand(
    val center: List<Double> = emptyList(),
    val radius: Double = 0.0,
    val hits: List<Int> = emptyList(),
)

// 공수부대(병력 수송, C→S, /app/airdrop). sources=원 안 내 소유 동 목록(클라 계산),
// dest=투하 목적지. 서버가 소유·쿨타임을 검증하고 sources 병력 전부를 dest에 투하한다.
data class AirdropCommand(val sources: List<Int> = emptyList(), val dest: Int = -1)

data class ErrorMessage(val code: String, val message: String, val from: Int, val to: Int)

/** cells: [admIndex, ownerId, troops] 튜플 (api-spec.md §2.5). */
data class DeltaMessage(
    val serverTimeMs: Long,
    val cells: List<IntArray>,
    val newOrders: List<Order>,
    val events: List<LogEvent>,
    val missileAdd: List<Int>, // 이번 구간에 새로 스폰된 미사일 동
    val missileRemove: List<Int>, // 이번 구간에 사라진 미사일 동(발사 소모)
    // 이번 구간에 미사일이 착탄한 동(중립화 대상 전부). 클라가 폭발 충격파를 터뜨린다 — "이미 중립이던
    // 동"을 맞춰 소유권 변화가 없어도 모션이 뜨도록 명시적으로 싣는다(worldView.ts missileImpacts와 대응).
    val missileImpacts: List<Int>,
    // 이번 구간에 새로 생긴 holder(신규 참가자). 이미 접속 중인 다른 클라의 world.holders엔
    // 없는 정보라, 그 holder의 첫 cells 변경과 "같은" DELTA에 실어 보낸다 — 그래야 클라가
    // paletteIdx를 몰라 땅 색을 잘못(fallback) 칠하는 순간이 아예 생기지 않는다.
    val newHolders: List<Holder>,
    val shieldUpdates: List<ShieldInfo>, // 이번 구간에 새로 생기거나 갱신된 방어막(신규 참가·재시작)
    // 현재 포위(귀속 대기)된 동 전체. 집합이 바뀐 tick에만 실어 보낸다(안 바뀌면 null → 클라가 유지).
    // 클라가 이 동들을 반짝이게 한다(worldView.ts enclosed와 대응).
    @get:JsonInclude(JsonInclude.Include.NON_NULL)
    val enclosed: List<Int>? = null,
    // 전술핵 발사로 사일로 쿨다운이 바뀐 tick에만 실린다(NUKE_SILO_CODES 순서, serverTimeMs 시간축).
    @get:JsonInclude(JsonInclude.Include.NON_NULL)
    val nukeReadyAtMs: List<Long>? = null,
)

data class LeaderboardMessage(
    val rows: List<LeaderboardRow>,
    val envCells: Int,
    val totalCells: Int,
)

// ── 로비/방(다중 세션) ─────────────────────────────────────────────────

/** 로비 목록의 방 한 개 요약(/topic/rooms). state는 "LOBBY"|"PLAYING"|"ENDED"로 직렬화. */
data class RoomInfo(
    val roomId: String,
    val name: String,
    val mapId: String,
    val state: RoomState,
    val memberCount: Int,
    val maxMembers: Int,
)

/** 공개 방 목록(S→C, /topic/rooms). 멤버십·상태가 바뀔 때마다 브로드캐스트. */
data class RoomListMessage(val rooms: List<RoomInfo>)

/** 방 멤버 요약. holderId는 라운드 중에만 유효(-1=로비/미배정). host=방장, ready=대기실 준비 상태. */
data class MemberInfo(val nickname: String, val holderId: Int, val ready: Boolean, val host: Boolean)

/** 방 입장 응답(S→C, /user/queue/roomJoined). youAreHost로 수신자가 방장인지 알려준다(승계 통지 겸용). */
data class RoomJoinedMessage(
    val roomId: String,
    val name: String,
    val mapId: String,
    val state: RoomState,
    val members: List<MemberInfo>,
    val youAreHost: Boolean,
)

/** 방 상태/멤버 변경 브로드캐스트(S→C, /topic/room/{id}/state). */
data class RoomStateMessage(
    val roomId: String,
    val state: RoomState,
    val members: List<MemberInfo>,
)

/** 라운드 종료 결과(S→C, /topic/room/{id}/state). reason="DOMINATION"|"TIMEOUT". */
data class RoundEndMessage(
    val roomId: String,
    val reason: String,
    val winnerHolderId: Int,
    val winnerName: String?,
    val leaderboard: List<LeaderboardRow>,
)

/** 방 생성(C→S, /app/lobby/create). 생성 즉시 생성자가 그 방에 입장한다. clientId=영속 클라 신원(방장용).
 * mapId는 MapCatalog에 없는 값이거나 생략되면 서버가 기본 지도로 대체한다(RoomManager.create). */
data class CreateRoomCommand(
    val name: String? = null,
    val mapId: String? = null,
    val nickname: String? = null,
    val token: String? = null,
    val clientId: String? = null,
)

/** 방 입장(C→S, /app/lobby/join). clientId=영속 클라 신원(재접속 시 방장·멤버 동일성 유지용). */
data class JoinRoomCommand(
    val roomId: String = "",
    val nickname: String? = null,
    val token: String? = null,
    val clientId: String? = null,
)

/** 대기실 준비 토글(C→S, /app/room/ready). 방장이 아닌 멤버가 사용. */
data class SetReadyCommand(val ready: Boolean = false)
