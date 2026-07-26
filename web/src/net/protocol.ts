// docs/api-spec.md — 클라이언트 ↔ 서버 통신 메시지 타입.
// 지금은 서버가 없어 net/localConnection.ts(core.ts 기반 브라우저 내 목 서버)가
// 이 메시지들을 발신/수신한다. STOMP 실서버로 교체 시 이 타입은 그대로 계약이 된다.
//
// NOTE(문서 동기화): api-spec.md는 holder 색을 fillColorIdx/strokeColorIdx로 적었으나,
// 실제 코드(types.ts Holder, config.ts PALETTE)는 단일 paletteIdx(짝지어진 fill+stroke)를
// 쓴다. 컨벤션 §5 "코드가 기준"에 따라 여기서는 paletteIdx로 통일한다. (api-spec 갱신 필요)

// CONFIG는 `typeof CONFIG`로 값 타입을 뽑아 쓰므로 값 import (verbatimModuleSyntax).
import { CONFIG } from "../config";
import type { DongStaticMeta, Holder, LogEntry, Order } from "../game/types";

// ── C→S ──────────────────────────────────────────────────────────────

// api-spec §2.1 — 최초 접속 또는 재접속(토큰 보유)
export interface JoinMessage {
  nickname: string; // 신규만. 1~12자 (서버가 trim/검증)
  token?: string; // 재접속 시 localStorage의 UUID. 없으면 신규
}

// api-spec §2.3 — amount = floor(troops*ratio)를 서버가 계산. ratio는 플레이어가
// UI 슬라이더로 정한 이번 출정의 병력 비율(0~1). 서버가 안전 범위로 클램프한다.
export interface SortieCommand {
  from: number; // 내 소유 admIndex
  to: number; // from에 인접한 admIndex
  ratio: number; // 출정 병력 비율 (0~1). 없으면 서버 기본(SORTIE_RATIO)
}

// B1 경로 자동 출정(C→S). to = 멀리 있는 내 소유 admIndex(인접 아니어도 됨). 서버가 내 영토를
// 따라 최단 경로를 찾아 연쇄 출정(릴레이 컬럼)을 발주한다. 경로가 없으면 NO_PATH 에러로 돌아온다.
export interface MarchCommand {
  from: number; // 내 소유 admIndex(출발지)
  to: number; // 내 소유 admIndex(최종 목적지). from과 인접하지 않아도 됨
  ratio: number; // 보낼 병력 비율(0~1)
}

// 미사일 발사(C→S). center=원 중심 [lng,lat], radius=반경(도), hits=원에 겹치는 동
// admIndex 목록(폴리곤을 가진 클라가 계산). 서버가 반경/근접을 검증하고 미사일 1개를
// 소모해 hits를 중립화한다.
export interface LaunchMissileCommand {
  center: [number, number];
  radius: number;
  hits: number[];
}

// B2 집결지 지정/해제(C→S). index = 내 소유 admIndex(집결지), -1이면 해제. 서버가 소유를 검증하고
// 이후 매 주기 후방 병력을 이 동을 향해 자동 전진시킨다.
export interface SetRallyCommand {
  index: number;
}

// ── S→C ──────────────────────────────────────────────────────────────

// api-spec §2.2 — JOIN 응답. 전체 스냅샷 1회, 이후 변경분은 DELTA로만.
export interface WelcomeMessage {
  holderId: number;
  token: string; // 재접속용. 클라는 localStorage에 저장
  serverTimeMs: number; // 시간 동기화용
  config: typeof CONFIG; // 서버가 원본 (plan.md §4)

  // 정적 메타 — 게임 중 불변, 1회만
  meta: DongStaticMeta[];
  neighborIndex: number[][];

  // 가변 상태 — 이후 DELTA로만 갱신 (JSON이라 일반 배열로 옴)
  ownerId: number[];
  troops: number[];
  troopCap: number[];
  holders: Holder[]; // 중립·환경세력 포함
  orders: Order[]; // 진행 중 이동 유닛(재접속 시 이어서 보간)
  missiles: number[]; // 미사일이 얹힌 동 admIndex 목록
  rally: number; // B2 — 이 플레이어의 집결지 admIndex(-1=없음). 재접속 시 복구용.
}

// api-spec §2.4 — SORTIE 거부 시 요청자에게만
export interface ErrorMessage {
  code: "NOT_OWNER" | "NOT_ADJACENT" | "NO_TROOPS" | "ALREADY_FULL" | "NO_MISSILE" | "NO_PATH";
  message: string; // 사용자 표시용(한국어)
  from: number;
  to: number;
}

// api-spec §2.5 — 변경분 브로드캐스트 (5Hz)
export type CellDelta = [admIndex: number, ownerId: number, troops: number];

export interface DeltaMessage {
  serverTimeMs: number;
  cells: CellDelta[]; // 변경된 동만
  newOrders: Order[]; // 이번 구간에 새로 발주된 이동 유닛(출발)
  events: LogEntry[]; // 함락/침공/토벌 로그(append-only)
  missileAdd: number[]; // 이번 구간에 미사일이 새로 스폰된 동
  missileRemove: number[]; // 이번 구간에 미사일이 사라진 동(발사 소모 등)
  // 이번 구간에 새로 생긴 holder(신규 참가자). 이미 접속 중인 다른 클라의 world.holders엔
  // 없는 정보라, 그 holder의 첫 cells 변경과 "같은" DELTA에 실려 온다 — paletteIdx를 몰라
  // 땅 색을 잘못(fallback 회색) 칠하는 순간이 아예 생기지 않는다.
  newHolders: Holder[];
}

// api-spec §2.6 — 순위표 (1Hz). E는 rows에서 제외, envCells는 잔존 표시용
export interface LeaderboardMessage {
  rows: { holderId: number; name: string; count: number }[];
  envCells: number;
  totalCells: number;
}
