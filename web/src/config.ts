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
  // 유닛 이동: 출발지→목적지 원 하나가 이동하는 데 걸리는 시간(거리 기반, 초).
  // 눈으로 이동을 또렷이 볼 수 있게 넉넉히 잡는다.
  UNIT_SPEED_DEG_PER_SEC: 0.02, // 경위도 거리 기준 이동 속도 (느릴수록 오래 보임)
  UNIT_TRAVEL_MIN_SEC: 0.7,
  UNIT_TRAVEL_MAX_SEC: 2.2,

  // 환경 세력 (E, README §4.6) — 초반 긴장용 조연(문명 야만인). 전부 튜닝값.
  ENV_HOLDER_ID: 255, // E 전용 holderId (예약)
  ENV_START_CELLS: 3, // 시작 시 E 보유 동 수
  ENV_PROD_MULT: 1.0, // E 생산 배율 (기본 = 플레이어와 동일, 램프 없음)
  ENV_ACT_INTERVAL_SEC: 6, // E 행동 주기(초)
  ENV_ATTACK_MARGIN: 1.2, // 이길 만할 때만 공격 (자살 방지 계수)
  ENV_BOUNTY: 10, // E 동 함락 시 보너스 병력
  ENV_MAX_RATIO: 0.04, // E 보유 동 수 하드 상한 (전체 대비 비율)
  ENV_MIN_PRESENCE: 4, // 극초반 E 최소 존재감(동 수)
} as const;

// holderId 0 = 중립. 목업은 단일 플레이어이므로 1만 사용.
export const NEUTRAL_HOLDER_ID = 0;
export const MY_HOLDER_ID = 1;

// 범위 (README.md §2.3): null = 전국 전체(~3,500동, 데모 기본).
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
