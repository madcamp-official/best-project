package com.madcamp.server.ws.dto

import com.fasterxml.jackson.annotation.JsonInclude
import com.madcamp.server.config.GameConfig
import com.madcamp.server.domain.DongStaticMeta
import com.madcamp.server.domain.Holder
import com.madcamp.server.domain.LeaderboardRow
import com.madcamp.server.domain.LogEvent
import com.madcamp.server.domain.Order

// docs/api-spec.md §2 그대로 대응하는 STOMP 페이로드. 필드 하나하나가 문서의 표와 1:1.

data class JoinMessage(val nickname: String? = null, val token: String? = null)

data class WelcomeMessage(
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
    val rally: Int, // B2 — 이 플레이어의 집결지 admIndex(-1=없음). 재접속 복구용.
)

// ratio: 플레이어가 UI 슬라이더로 정한 이번 출정 병력 비율(0~1). 생략/비정상값이면
// 서버가 CONFIG.SORTIE_RATIO로 대체한다(web/src/net/protocol.ts §2.3과 동일 계약).
data class SortieCommand(val from: Int, val to: Int, val ratio: Double? = null)

// B1 경로 자동 출정(C→S, /app/march). to는 from과 인접하지 않아도 되며, 서버가 내 영토를 따라
// 최단 경로를 찾아 연쇄 출정을 발주한다. web/src/net/protocol.ts MarchCommand과 동일 계약.
data class MarchCommand(val from: Int, val to: Int, val ratio: Double? = null)

// 미사일 발사(C→S, /app/missile). center=[lng,lat], radius=반경(도), hits=원에 겹치는 동
// admIndex(폴리곤을 가진 클라가 계산). 서버가 반경/근접을 검증하고 미사일 1개를 소모해 적용.
data class LaunchMissileCommand(
    val center: List<Double> = emptyList(),
    val radius: Double = 0.0,
    val hits: List<Int> = emptyList(),
)

// B2 집결지 지정/해제(C→S, /app/rally). index = 내 소유 admIndex, -1이면 해제.
data class SetRallyCommand(val index: Int = -1)

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
    // 현재 포위(귀속 대기)된 동 전체. 집합이 바뀐 tick에만 실어 보낸다(안 바뀌면 null → 클라가 유지).
    // 클라가 이 동들을 반짝이게 한다(worldView.ts enclosed와 대응).
    @get:JsonInclude(JsonInclude.Include.NON_NULL)
    val enclosed: List<Int>? = null,
)

data class LeaderboardMessage(
    val rows: List<LeaderboardRow>,
    val envCells: Int,
    val totalCells: Int,
)
