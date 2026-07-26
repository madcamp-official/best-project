package com.madcamp.server.domain

// web/src/game/types.ts 1:1 대응 (plan.md §4 — 서버 이식 시 대조 자료).

data class Holder(
    val id: Int,
    var name: String,
    val paletteIdx: Int,
)

/** README §4.4 — 유닛 이동 이음매. departTick/arriveTick은 서버 벽시계(epoch ms) 기준. */
data class Order(
    val from: Int,
    val to: Int,
    val amount: Int,
    val holderId: Int,
    val departTick: Long,
    val arriveTick: Long,
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

enum class Rank { DONGJANG, SIJANG, DOJISA }

data class LeaderboardRow(
    val holderId: Int,
    val name: String,
    val count: Int,
)

sealed interface SortieResult {
    data object Ok : SortieResult
    data class Err(val code: SortieErrorCode, val message: String) : SortieResult
}

enum class SortieErrorCode { NOT_OWNER, NOT_ADJACENT, NO_TROOPS, ALREADY_FULL }
