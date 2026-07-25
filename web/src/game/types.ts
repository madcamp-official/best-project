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
}

export interface LogEntry {
  id: number;
  ts: number;
  message: string;
}

export type Rank = "동장" | "시장" | "도지사" | null;

export interface DongStaticMeta {
  admIndex: number;
  code: string; // emd8
  name: string;
  sggcd: string;
  sggnm: string;
  sidocd: string;
  sidonm: string;
  centroid: [number, number]; // polylabel 기준(라벨/배지 위치용)
}
