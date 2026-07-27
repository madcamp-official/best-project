// docs/plan.md, README.md §5 튜닝 상수 — 모든 밸런스 값은 이 객체 한 곳에.
export const CONFIG = {
  FILL_TO_CAP_SEC: 180, // 빈 동 → 상한 충전 시간(초)
  BASE_CAP: 50, // 병력 상한 base (튜닝)
  CAP_K: 0.4, // 인구 정규화 압축 강도 (튜닝, 목업에서는 미사용)
  CAP_MIN_MULT: 0.7,
  CAP_MAX_MULT: 1.5,
  NEUTRAL_TROOPS: 10, // 중립 동 방어 병력 (튜닝, 낮게)
  SORTIE_RATIO: 0.5, // 출정 비율 (절반)
  RESET_OWN_RATIO: 0.5, // 전국 50% 점유 시 시즌 리셋 (목업 제외, 값만 명시)
  ANNEX_HOLD_SEC: 5, // 포위 귀속: 한 플레이어가 완전히 둘러싼 상태를 이 시간(초) 유지하면 흡수
  // 유닛 이동: 출발지→목적지 원 하나가 이동하는 데 걸리는 시간(거리 기반, 초).
  // 눈으로 이동을 또렷이 볼 수 있게 넉넉히 잡는다.
  UNIT_SPEED_DEG_PER_SEC: 0.02, // 경위도 거리 기준 이동 속도 (느릴수록 오래 보임)
  UNIT_TRAVEL_MIN_SEC: 0.7,
  UNIT_TRAVEL_MAX_SEC: 2.2,

  // 환경 세력 (E, README §4.6) — 초반 긴장용 조연(문명 야만인). 전부 튜닝값.
  ENV_HOLDER_ID: 255, // E 전용 holderId (예약)
  ENV_CLUSTER_COUNT: 10, // 야만인 무리 수 — 전국에 흩뿌리는 캠프 개수 (1이면 기존처럼 플레이어 근처 한 무리)
  ENV_START_CELLS: 5, // 무리 1개당 시작 E 보유 동 수
  ENV_PROD_MULT: 0.7, // E 생산 배율 (기본 = 플레이어와 동일, 램프 없음)
  ENV_ACT_INTERVAL_SEC: 3, // E 행동 주기(초)
  ENV_ATTACK_MARGIN: 1.2, // 이길 만할 때만 공격 (자살 방지 계수)
  ENV_BOUNTY: 10, // E 동 함락 시 보너스 병력
  ENV_MAX_RATIO: 0.1, // E 보유 동 수 하드 상한 (전체 대비 비율)
  // ENV_CLUSTER_COUNT(3) * ENV_START_CELLS(3) = 9개로 시작하므로 그보다 커야 한다 — 안 그러면
  // 스폰 직후부터 envCells(9) >= cap이 되어 E가 첫 행동도 못 해보고 얼어붙는다("야만인이 가만히
  // 있다" 버그. 다중 클러스터 도입 시 이 값을 안 올려서 생겼다).
  ENV_MIN_PRESENCE: 30, // 극초반 E 최소 존재감(동 수)

  // 미사일 — 동에 종속 스폰 → 소유 시 발사(즉발), 원 범위의 동을 중립화(병력 0).
  MISSILE_SPAWN_SEC: 5, // 전국에서 무작위 동 1곳에 미사일이 스폰되는 주기(초) — 체감상 적어서 2배로 상향
  MISSILE_MAX_TOTAL: 60, // 맵 전체 동시 존재 미사일 총 상한(소유·중립 무관). 도달 시 스폰 중단. (2배 상향, 개인 한도 없음)
  MISSILE_RADIUS_DEG: 0.02, // 발사 적용 원 반경(경위도 도 단위, ~2km). 클라·서버 공유.

  // 경로 자동 출정(B1) — 멀리 있는 내 동을 우클릭하면 내 영토를 따라 최단 경로로 연쇄 출정.
  MARCH_MAX_HOPS: 60, // 자동 경로 최대 홉(원거리 남용/BFS 비용 방지)

  // 보급선(B2) — 집결지를 정하면 후방 병력이 내 영토 경사를 따라 매 주기 한 홉씩 전선으로 자동 전진.
  SUPPLY_INTERVAL_SEC: 1.5, // 보급 흐름 tick 주기(초)
  SUPPLY_RATIO: 0.34, // 보급 tick당 후방 동에서 집결지 쪽 이웃으로 흘려보내는 병력 비율
  SUPPLY_MIN_TROOPS: 5, // 이 수 이하 병력은 보급으로 옮기지 않음(잔챙이 이동·과도한 DELTA 방지)

  // 공수부대(병력 수송, B3) — 원으로 고른 내 동들의 병력 전부를 삼각형 유닛으로 목적지에 투하.
  // 상한 초과분은 목적지에서 인접 BFS로 순차 flood(적/중립은 전투로 점령).
  AIRDROP_COOLDOWN_SEC: 30, // 플레이어당 재사용 대기(초). 출발지 선택 원 반경은 미사일과 동일(MISSILE_RADIUS_DEG).
  // 사거리 상한(출발 동↔목적지 centroid 거리, 도 단위). 섬 도달이 목적이라 섬↔육지 최대 간격 기준.
  // 울릉도(1.5°)는 극단 외딴섬이라 제외하고, 나머지 72개 섬(최대 흑산도 ~0.5°)까지 닿도록 0.55.
  AIRDROP_MAX_RANGE_DEG: 0.55, // 클라·서버 공유
} as const;

// holderId 0 = 중립. 목업은 단일 플레이어이므로 1만 사용.
export const NEUTRAL_HOLDER_ID = 0;
export const MY_HOLDER_ID = 1;

// 범위 (README.md §2.3): null = 전국 전체(~5,065 법정동, 데모 기본).
// "11" 처럼 시도 코드를 넣으면 그 시도만 로드 — 전국 렌더 성능이 막힐 때의 폴백.
export const SCOPE_SIDOCD: string | null = null;

// holder의 paletteIdx → 채움/테두리 색. (holderId가 아니라 holder.paletteIdx로 매핑 —
// 플레이어가 6명을 넘어도, 환경 세력(255)이어도 이 슬롯 하나로 색이 정해진다.)
// 플레이어 구분은 테두리(진하고 채도 높은 색)가 담당하고, 채움은 그 위에 얹는
// 옅고 투명한 색유리 틴트로만 쓴다 — 그래서 fill은 밝은 파스텔, stroke는 같은
// 색상의 짙은 톤으로 fill보다 항상 더 진하게 짝지었다.
export const PALETTE: { fill: string; stroke: string }[] = [
  { fill: "#333a46", stroke: "#7d8699" }, // 0: 중립 (무채색)
  { fill: "#f3a5a5", stroke: "#a30f1f" }, // 1: 플레이어 레드
  { fill: "#a9c8fb", stroke: "#1740b8" }, // 2: 블루
  { fill: "#a7ecc0", stroke: "#0f7a3d" }, // 3: 그린
  { fill: "#fbdf9c", stroke: "#a3540a" }, // 4: 앰버
  { fill: "#dcbafc", stroke: "#6b1fac" }, // 5: 퍼플
  { fill: "#c3d152", stroke: "#5a6b0d" }, // 6: 환경 세력(E) — 독성 올리브그린 (플레이어와 혼동 없게)
];

// 환경 세력(E) 전용 팔레트 슬롯. README §7.1 — 팔레트 밖 색을 E에 고정 배정.
export const ENV_PALETTE_IDX = 6;
// 플레이어에게 순환 배정할 색 슬롯(중립 0·E 6 제외). 6명 초과 시 색이 겹칠 수 있으나 데모 규모에선 충분.
export const PLAYER_PALETTE_IDXS = [1, 2, 3, 4, 5];

export const SELECTED_OUTLINE_COLOR = "#ffffff";
