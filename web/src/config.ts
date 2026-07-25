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
} as const;

// holderId 0 = 중립. 목업은 단일 플레이어이므로 1만 사용.
export const NEUTRAL_HOLDER_ID = 0;
export const MY_HOLDER_ID = 1;

// 범위 (README.md §2.3): null = 전국 전체(~3,500동, 데모 기본).
// "11" 처럼 시도 코드를 넣으면 그 시도만 로드 — 전국 렌더 성능이 막힐 때의 폴백.
export const SCOPE_SIDOCD: string | null = null;

// holderId(팔레트 인덱스) → 채움/테두리 색.
// 플레이어 구분은 테두리(진하고 채도 높은 색)가 담당하고, 채움은 그 위에 얹는
// 옅고 투명한 색유리 틴트로만 쓴다 — 그래서 fill은 밝은 파스텔, stroke는 같은
// 색상의 짙은 톤으로 fill보다 항상 더 진하게 짝지었다.
export const PALETTE: { fill: string; stroke: string }[] = [
  { fill: "#333a46", stroke: "#7d8699" }, // 0: 중립 (무채색)
  { fill: "#f3a5a5", stroke: "#a30f1f" }, // 1: 나 (레드)
  { fill: "#a9c8fb", stroke: "#1740b8" }, // 블루
  { fill: "#a7ecc0", stroke: "#0f7a3d" }, // 그린
  { fill: "#fbdf9c", stroke: "#a3540a" }, // 앰버
  { fill: "#dcbafc", stroke: "#6b1fac" }, // 퍼플
];

export const SELECTED_OUTLINE_COLOR = "#ffffff";
