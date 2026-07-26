package com.madcamp.server.config

import com.fasterxml.jackson.annotation.JsonProperty

/**
 * README.md §5 CONFIG — 모든 밸런스 값은 이 객체 한 곳에.
 * var 필드로 둔 이유: [com.madcamp.server.admin.AdminController]의 `/admin/config`가
 * 서버 재시작 없이 런타임 리로드할 수 있어야 한다(plan.md §6 리스크 대응).
 *
 * @JsonProperty로 web/src/config.ts의 CONFIG 키(SCREAMING_SNAKE_CASE)와 와이어 포맷을
 * 맞춘다 — Kotlin 쪽은 관례대로 camelCase를 쓰되, WELCOME.config로 나가는 JSON은
 * 클라가 이미 알고 있는 키 이름 그대로다(api-spec.md §2.2, plan.md §4 "CONFIG는 서버가 원본").
 */
data class GameConfig(
    @JsonProperty("FILL_TO_CAP_SEC") var fillToCapSec: Double = 180.0,
    @JsonProperty("BASE_CAP") var baseCap: Int = 50,
    @JsonProperty("CAP_K") var capK: Double = 0.4,
    @JsonProperty("CAP_MIN_MULT") var capMinMult: Double = 0.7,
    @JsonProperty("CAP_MAX_MULT") var capMaxMult: Double = 1.5,
    @JsonProperty("NEUTRAL_TROOPS") var neutralTroops: Int = 10,
    @JsonProperty("SORTIE_RATIO") var sortieRatio: Double = 0.5,
    @JsonProperty("RESET_OWN_RATIO") var resetOwnRatio: Double = 0.5,

    // 유닛 이동(README §4.4, 거리 기반 arriveTick)
    @JsonProperty("UNIT_SPEED_DEG_PER_SEC") var unitSpeedDegPerSec: Double = 0.02,
    @JsonProperty("UNIT_TRAVEL_MIN_SEC") var unitTravelMinSec: Double = 0.7,
    @JsonProperty("UNIT_TRAVEL_MAX_SEC") var unitTravelMaxSec: Double = 2.2,

    // 환경 세력(E, README §4.6) — 초반 긴장용 조연(문명 야만인 모델).
    // 클라 config.ts에는 아직 이 키들이 없다(E 미구현) — README §5 표기를 그대로 따른다.
    @JsonProperty("ENV_START_CELLS") var envStartCells: Int = 3,
    @JsonProperty("ENV_PROD_MULT") var envProdMult: Double = 1.0,
    @JsonProperty("ENV_ACT_INTERVAL_SEC") var envActIntervalSec: Double = 6.0,
    @JsonProperty("ENV_ATTACK_MARGIN") var envAttackMargin: Double = 1.2,
    @JsonProperty("ENV_BOUNTY") var envBounty: Int = 10,
    @JsonProperty("ENV_MAX_RATIO") var envMaxRatio: Double = 0.04,
    @JsonProperty("ENV_MIN_PRESENCE") var envMinPresence: Int = 4,
)

/** holderId 예약값(README §3.2). 튜닝 대상이 아니므로 GameConfig와 분리한 구조 상수. */
object HolderIds {
    const val NEUTRAL: Int = 0
    const val ENV: Int = 255
}
