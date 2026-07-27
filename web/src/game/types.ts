export interface Holder {
  id: number;
  name: string;
  paletteIdx: number;
}

// README.md §4.4 — 유닛 이동 이음매. 출발 시 병력을 출발지에서 빼고, arriveTick에
// 도달하면 목적지에서 전투/증원을 적용한다. 그 사이엔 원(circle) 유닛이 이동한다.
export interface Order {
  from: number;
  to: number;
  amount: number;
  holderId: number; // 파견한 소유주 (도착 시 전투 판정 주체)
  departTick: number;
  arriveTick: number;
  // 경로 자동 출정(B1): to 도착 후 이어서 방문할 남은 홉(최종 목적지가 마지막). 비면 to가 최종.
  // 릴레이 컬럼은 to를 '통과'만 하고 다음 홉으로 이어지며, 병력은 최종 목적지에서만 정착한다.
  path?: number[];
  // 공수부대(B3): true면 도착 시 목적지에 투하 후 상한 초과분을 인접 flood로 점령/증원한다.
  // 렌더러는 이 플래그로 원 대신 삼각형 유닛을 그린다.
  airdrop?: boolean;
}

// 스폰 방어막 — holderId가 until(서버 epoch ms, stompConnection이 로컬 시간축으로 변환)까지 보호됨.
export interface ShieldInfo {
  holderId: number;
  until: number;
}

export interface LogEntry {
  id: number;
  ts: number;
  message: string;
}

export type Rank = "동장" | "시장" | "도지사" | null;

export interface DongStaticMeta {
  admIndex: number;
  code: string; // 법정동코드 8자리 ([시도2][시군구3][읍면동3])
  name: string;
  sggcd: string;
  sggnm: string;
  sidocd: string;
  sidonm: string;
  centroid: [number, number]; // polylabel 기준(라벨/배지 위치용)
}
