package com.madcamp.server.config

import com.fasterxml.jackson.annotation.JsonProperty

/**
 * web/src/config.ts CONFIG 1:1 대응 — 필드 이름·기본값 모두 그 파일이 원본이다.
 * var로 둔 이유: [com.madcamp.server.admin.AdminController]의 `/admin/config`가
 * 서버 재시작 없이 런타임 리로드할 수 있어야 한다(plan.md §6 리스크 대응).
 *
 * @JsonProperty로 클라 CONFIG 키(SCREAMING_SNAKE_CASE)와 와이어 포맷을 맞춘다 — Kotlin
 * 쪽은 관례대로 camelCase를 쓰되, WELCOME.config로 나가는 JSON은 클라가 이미 로컬
 * localConnection에서 쓰던 CONFIG 그대로다(api-spec.md §2.2, plan.md §4 "CONFIG는 서버가 원본").
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
    @JsonProperty("ANNEX_HOLD_SEC") var annexHoldSec: Double = 5.0, // 포위 귀속: 완전 포위 유지 시간(초)

    // 유닛 이동(README §4.4, 거리 기반 arriveTick)
    @JsonProperty("UNIT_SPEED_DEG_PER_SEC") var unitSpeedDegPerSec: Double = 0.02,
    @JsonProperty("UNIT_TRAVEL_MIN_SEC") var unitTravelMinSec: Double = 0.7,
    @JsonProperty("UNIT_TRAVEL_MAX_SEC") var unitTravelMaxSec: Double = 2.2,

    // 환경 세력(E, README §4.6) — 초반 긴장용 조연(문명 야만인 모델).
    // ENV_HOLDER_ID는 클라 CONFIG 안에도 들어있는 값이라(web/src/config.ts) 여기 포함한다 —
    // HolderIds.ENV(구조 상수)와 항상 같은 값을 유지해야 한다.
    @JsonProperty("ENV_HOLDER_ID") var envHolderId: Int = HolderIds.ENV,
    @JsonProperty("ENV_CLUSTER_COUNT") var envClusterCount: Int = 3, // 야만인 무리 수(전국에 흩뿌리는 캠프 개수)
    @JsonProperty("ENV_START_CELLS") var envStartCells: Int = 3, // 무리 1개당 시작 보유 동 수
    @JsonProperty("ENV_PROD_MULT") var envProdMult: Double = 1.0,
    @JsonProperty("ENV_ACT_INTERVAL_SEC") var envActIntervalSec: Double = 6.0,
    @JsonProperty("ENV_ATTACK_MARGIN") var envAttackMargin: Double = 1.2,
    @JsonProperty("ENV_BOUNTY") var envBounty: Int = 10,
    @JsonProperty("ENV_MAX_RATIO") var envMaxRatio: Double = 0.1,
    // ENV_CLUSTER_COUNT(3) * ENV_START_CELLS(3) = 9개로 시작하므로 그보다 커야 한다 — 안 그러면
    // 스폰 직후부터 already envCells(9) >= cap이 되어 E가 첫 행동도 못 해보고 얼어붙는다(실전에서
    // "야만인이 가만히 있다"로 발견된 버그. 다중 클러스터 도입 시 이 값을 안 올려서 생겼다).
    @JsonProperty("ENV_MIN_PRESENCE") var envMinPresence: Int = 12,

    // 미사일 — 동에 종속 스폰 → 소유 시 발사(즉발), 원 범위의 동을 중립화(병력 0).
    @JsonProperty("MISSILE_SPAWN_SEC") var missileSpawnSec: Double = 5.0, // 체감상 적어서 2배로 상향
    @JsonProperty("MISSILE_MAX_TOTAL") var missileMaxTotal: Int = 60, // 맵 전체 동시 존재 상한(2배 상향, 개인 한도 없음)
    @JsonProperty("MISSILE_RADIUS_DEG") var missileRadiusDeg: Double = 0.02,
    @JsonProperty("MISSILE_MAX_RADIUS_DEG") var missileMaxRadiusDeg: Double = 0.06, // 발사 반경 검증 상한
    @JsonProperty("MISSILE_HIT_MARGIN_DEG") var missileHitMarginDeg: Double = 0.05, // 타격 centroid 근접 여유

    // 경로 자동 출정(B1) — 멀리 있는 내 동으로 내 영토를 따라 최단 경로 연쇄 출정.
    @JsonProperty("MARCH_MAX_HOPS") var marchMaxHops: Int = 60, // 자동 경로 최대 홉

    // 보급선(B2) — 집결지를 향해 후방 병력을 매 주기 한 홉씩 자동 전진(내 영토 경사 흐름).
    @JsonProperty("SUPPLY_INTERVAL_SEC") var supplyIntervalSec: Double = 1.5,
    @JsonProperty("SUPPLY_RATIO") var supplyRatio: Double = 0.34,
    @JsonProperty("SUPPLY_MIN_TROOPS") var supplyMinTroops: Int = 5,

    // 공수부대(병력 수송, B3) — 원으로 고른 내 동들의 병력 전부를 목적지에 투하, 초과분은 인접 flood.
    @JsonProperty("AIRDROP_COOLDOWN_SEC") var airdropCooldownSec: Double = 30.0, // 플레이어당 재사용 대기(초, 클라 config.ts와 동기)
    @JsonProperty("AIRDROP_MAX_RANGE_DEG") var airdropMaxRangeDeg: Double = 0.55, // 사거리 상한(출발↔목적지 centroid 도 단위)

    // 공수 삼각형 유닛 이동 속도 — 일반 유닛보다 조금 느리게(수송이 또렷이 보이게). 클라 config.ts와 동기.
    @JsonProperty("AIRDROP_SPEED_DEG_PER_SEC") var airdropSpeedDegPerSec: Double = 0.013,
    @JsonProperty("AIRDROP_TRAVEL_MAX_SEC") var airdropTravelMaxSec: Double = 3.5,

    // 스폰 방어막 — 신규 참가·재시작 직후 이 시간(초) 동안 내 동은 공격/미사일/포위/공수로부터
    // 보호된다(자기 자신의 SORTIE 등 능동 행동은 제한 없음). "시작하자마자 죽는" 문제 대응.
    @JsonProperty("SPAWN_SHIELD_SEC") var spawnShieldSec: Double = 120.0,
)

/** holderId 예약값(README §3.2). GameConfig.envHolderId와 항상 동기화되어야 하는 구조 상수. */
object HolderIds {
    const val NEUTRAL: Int = 0
    const val ENV: Int = 255
}

/**
 * web/src/config.ts의 PALETTE/ENV_PALETTE_IDX/PLAYER_PALETTE_IDXS와 맞춘 서버 쪽 배정표.
 * 팔레트 색상 자체는 순수 렌더링 관심사라 클라 소유지만, "어느 holder가 어느 슬롯을
 * 받는지"는 서버가 결정해서 내려줘야 하므로 인덱스 배정 규칙만 여기 둔다.
 */
object Palette {
    const val ENV_IDX: Int = 6
    val PLAYER_IDXS: IntArray = intArrayOf(1, 2, 3, 4, 5)
}
