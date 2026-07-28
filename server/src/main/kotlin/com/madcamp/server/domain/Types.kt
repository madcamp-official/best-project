package com.madcamp.server.domain

// web/src/game/types.ts 1:1 대응 (plan.md §4 — 서버 이식 시 대조 자료).

data class Holder(
    val id: Int,
    var name: String,
    val paletteIdx: Int,
    val isAi: Boolean = false, // AI 플레이어면 true(생산 배율·자동 행동 대상). 사람·중립은 false.
)

/** README §4.4 — 유닛 이동 이음매. departTick/arriveTick은 서버 벽시계(epoch ms) 기준. */
data class Order(
    val id: Int, // 이동 유닛 고유 id(미사일 타격·정면충돌 등으로 제거/변경 시 클라에서 지목용). types.ts Order.id 대응.
    val from: Int,
    val to: Int,
    // var — 정면충돌(tickOrderClashes) 승자가 차액만큼 병력이 줄어 계속 진행하므로 제자리 갱신한다.
    var amount: Int,
    val holderId: Int,
    val departTick: Long,
    val arriveTick: Long,
    // 경로 자동 출정(B1): to 도착 후 이어서 방문할 남은 홉(최종 목적지가 마지막). 비면 to가 최종.
    val path: List<Int> = emptyList(),
    // 공수부대(B3): true면 도착 시 목적지에 투하 후 상한 초과분을 인접 flood로 점령/증원한다.
    val airdrop: Boolean = false,
)

/** 이동 중 병력이 바뀐 유닛(정면충돌 승자의 차액). DELTA updatedOrders로 실려 클라가 amount를 갱신한다.
 *  web/src/net/protocol.ts DeltaMessage.updatedOrders 원소 { id, amount } 대응. */
data class OrderAmount(
    val id: Int,
    val amount: Int,
)

data class LogEvent(
    val id: Int,
    val ts: Long,
    val message: String,
)

data class DongStaticMeta(
    val admIndex: Int,
    val code: String,
    val name: String,
    val sggcd: String,
    val sggnm: String,
    val sidocd: String,
    val sidonm: String,
    val centroid: DoubleArray, // [lng, lat]
)

// GUCHEONGJANG(구청장) — 법정동 시절의 DONGJANG(동장)을 대체. 시/군/구 지도는 셀 하나가
// 이미 시군구 하나 전체라 "일부만 소유" 단계가 없어져, 그 자리를 진입 계급이 대신한다.
enum class Rank { GUCHEONGJANG, SIJANG, DOJISA, PRESIDENT }

data class LeaderboardRow(
    val holderId: Int,
    val name: String,
    val count: Int,
)

sealed interface SortieResult {
    data object Ok : SortieResult
    data class Err(val code: SortieErrorCode, val message: String) : SortieResult
}

enum class SortieErrorCode { NOT_OWNER, NOT_ADJACENT, NO_TROOPS, ALREADY_FULL, NO_PATH, AIRDROP_COOLDOWN, AIRDROP_RANGE }

/** 미사일 발사 결과. removed = 소모된(미사일이 얹혀 있던) 동, neutralized = 중립화된 동들. */
data class MissileLaunch(
    val ok: Boolean,
    val removed: Int = -1,
    val neutralized: List<Int> = emptyList(),
    val reason: String = "",
)

/** 스폰 방어막 — holderId가 until(서버 epoch ms)까지 보호됨. WELCOME(전체)·DELTA(변경분)로 전파. */
data class ShieldInfo(
    val holderId: Int,
    val until: Long,
)
