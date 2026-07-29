// docs/api-spec.md — 클라이언트 ↔ 서버 통신 메시지 타입.
// 지금은 서버가 없어 net/localConnection.ts(core.ts 기반 브라우저 내 목 서버)가
// 이 메시지들을 발신/수신한다. STOMP 실서버로 교체 시 이 타입은 그대로 계약이 된다.
//
// NOTE(문서 동기화): api-spec.md는 holder 색을 fillColorIdx/strokeColorIdx로 적었으나,
// 실제 코드(types.ts Holder, config.ts PALETTE)는 단일 paletteIdx(짝지어진 fill+stroke)를
// 쓴다. 컨벤션 §5 "코드가 기준"에 따라 여기서는 paletteIdx로 통일한다. (api-spec 갱신 필요)

// CONFIG는 `typeof CONFIG`로 값 타입을 뽑아 쓰므로 값 import (verbatimModuleSyntax).
import { CONFIG } from "../config";
import type { DongStaticMeta, Holder, LogEntry, Order, ShieldInfo } from "../game/types";

// ── C→S ──────────────────────────────────────────────────────────────

// api-spec §2.1 — 최초 접속 또는 재접속(토큰 보유)
export interface JoinMessage {
  nickname: string; // 신규만. 1~12자 (서버가 trim/검증)
  token?: string; // 재접속 시 localStorage의 UUID. 없으면 신규
  idToken?: string; // 구글 로그인(feat/google-login) — Firebase ID 토큰. 있으면 서버가 검증 후 계정 닉네임을 우선한다.
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

// 드래그 쓸기(C→S). 한 출발지(from)에서 여러 인접 목표(targets)로 병력을 균등 분할해 동시 출정.
// 서버가 인접·소유를 검증하고 출정 병력(troops*ratio)을 유효 목표 수로 나눠 보낸다.
export interface MultiSortieCommand {
  from: number; // 내 소유 admIndex(출발지)
  targets: number[]; // from과 인접한 목표 admIndex 목록(적·중립·내 동 혼재 가능)
  ratio: number; // 보낼 총 병력 비율(0~1) — 목표 수로 균등 분할된다
}

// 미사일 발사(C→S). center=원 중심 [lng,lat], radius=반경(도), hits=원에 겹치는 동
// admIndex 목록(폴리곤을 가진 클라가 계산). 서버가 반경/근접을 검증하고 미사일 1개를
// 소모해 hits를 중립화한다.
export interface LaunchMissileCommand {
  center: [number, number];
  radius: number;
  hits: number[];
}

// 전술핵 발사(C→S). 사일로(제주) 소유자만. hits = 전술핵 반경(일반 미사일의
// NUKE_RADIUS_MULT배) 원에 겹치는 동 admIndex 목록(클라 계산). 서버가 소유·쿨다운·근접을 검증한다.
export interface LaunchNukeCommand {
  center: [number, number];
  radius: number;
  hits: number[];
}

// 공격 큐 토글(C→S). index = 국경에 인접한 적·중립 admIndex. 이미 큐에 있으면 해제, 없으면
// (적·중립 + 내 영토 인접) 추가한다. 이후 매 주기 그 대상에 인접한 내 동들이 자동 공격한다.
export interface ToggleAttackTargetCommand {
  index: number;
}

// 공수부대(병력 수송, C→S). sources = 원 안에 든 내 소유 동 admIndex 목록(클라 계산),
// dest = 투하 목적지 admIndex(인접 아니어도 됨). 서버가 소유·쿨타임을 검증하고 sources 병력
// 전부를 dest에 투하, 상한 초과분은 인접 flood로 점령/증원한다.
export interface AirdropCommand {
  sources: number[];
  dest: number;
}

// 궤멸(소유 동 0개) 재시작 요청(C→S). 페이로드 없음 — 서버가 요청자 holderId로 소유 동 0개인지
// 확인하고, 맞으면 새 시작 동을 배정한다(DELTA로 전파). 아직 소유 동이 있으면 조용히 무시한다.
export type RestartCommand = Record<string, never>;

// ── S→C ──────────────────────────────────────────────────────────────

// api-spec §2.2 — JOIN 응답. 전체 스냅샷 1회, 이후 변경분은 DELTA로만.
export interface WelcomeMessage {
  roomId: string; // 이 스냅샷이 속한 방(다중 세션). 클라가 룸 스코프 토픽 구독에 쓴다.
  mapId: string; // 이 방이 쓰는 지도(data/loadMapData.ts MAP_ASSETS 키). 어느 geojson을 로드할지 결정.
  roundEndsAtMs: number; // 라운드 제한 시각(서버 epoch ms). 0=제한 없음(브리지/목업)
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
  attackQueue: number[]; // 이 플레이어의 공격 큐 admIndex 목록. 재접속 시 복구용.
  shields: ShieldInfo[]; // 지금 활성 상태인 방어막 전체 스냅샷(만료분 제외)
  // 전술핵 사일로별 재발사 가능 시각(NUKE_SILO_CODES 순서, serverTimeMs와 같은 시간축).
  // 사일로 위치 자체는 정적 데이터에서 파생되므로 보내지 않는다(클라가 initNukeState로 계산).
  nukeReadyAtMs: number[];
}

// api-spec §2.4 — SORTIE 거부 시 요청자에게만
export interface ErrorMessage {
  code:
    | "NOT_OWNER"
    | "NOT_ADJACENT"
    | "NO_TROOPS"
    | "ALREADY_FULL"
    | "NO_MISSILE"
    | "NO_NUKE" // 전술핵: 사일로 미보유 또는 재장전 중
    | "NO_PATH"
    | "AIRDROP_COOLDOWN"
    | "AIRDROP_RANGE"
    | "ROOM_NOT_FOUND" // 로비: 입장하려던 방이 없음(사라짐)
    | "ROOM_FULL" // 로비: 방 정원 초과
    | "ROOM_LIMIT" // 로비: 방 개수/동시 진행 상한
    | "NOT_HOST" // 대기실: 방장만 시작 가능
    | "NOT_READY"; // 대기실: 전원 준비 전 시작 불가
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
  // 이번 구간에 미사일이 착탄한 동(중립화 대상 전부). 렌더러가 폭발 충격파를 터뜨린다.
  // 소유권 변화로 착탄을 추론하면 "이미 중립인 동"을 맞출 때 모션이 안 뜨므로 명시적으로 싣는다.
  missileImpacts?: number[];
  // 전술핵 발사로 사일로 쿨다운이 바뀐 구간에만 실림(NUKE_SILO_CODES 순서, serverTimeMs 시간축).
  nukeReadyAtMs?: number[];
  // 현재 포위(귀속 대기)된 동 전체 목록. 집합이 바뀐 DELTA에만 실린다(없으면 클라가 기존 집합 유지).
  // 렌더러가 이 동들을 반짝이게 해 "곧 흡수됨"을 알린다(ANNEX_HOLD_SEC 카운트다운 시각화).
  enclosed?: number[];
  // 이번 구간에 새로 생긴 holder(신규 참가자). 이미 접속 중인 다른 클라의 world.holders엔
  // 없는 정보라, 그 holder의 첫 cells 변경과 "같은" DELTA에 실려 온다 — paletteIdx를 몰라
  // 땅 색을 잘못(fallback 회색) 칠하는 순간이 아예 생기지 않는다.
  newHolders: Holder[];
  shieldUpdates: ShieldInfo[]; // 이번 구간에 새로 생기거나 갱신된 방어막(신규 참가·재시작)
  // 이동 중 제거된 유닛 id(① 미사일 타격, ② 정면충돌 패배). 클라가 world.orders에서 뺀다.
  removedOrders?: number[];
  // 이동 중 병력이 바뀐 유닛(② 정면충돌 승자의 차액). 클라가 해당 order의 amount를 갱신한다.
  updatedOrders?: { id: number; amount: number }[];
}

// api-spec §2.6 — 순위표 (1Hz). E는 rows에서 제외, envCells는 잔존 표시용
export interface LeaderboardMessage {
  rows: { holderId: number; name: string; count: number }[];
  envCells: number;
  totalCells: number;
}

// ── 로비/방(다중 세션) ─────────────────────────────────────────────────

export type RoomState = "LOBBY" | "PLAYING" | "ENDED";

// 방 멤버 요약. holderId는 라운드 중에만 유효(-1=로비/미배정). host=방장, ready=대기실 준비 상태.
export interface MemberInfo {
  nickname: string;
  holderId: number;
  ready: boolean;
  host: boolean;
}

// 로비 목록의 방 한 개 요약(/topic/rooms).
export interface RoomInfo {
  roomId: string;
  name: string;
  mapId: string;
  state: RoomState;
  memberCount: number;
  maxMembers: number;
}

// 공개 방 목록(S→C, /topic/rooms). 멤버십·상태가 바뀔 때마다 브로드캐스트.
export interface RoomListMessage {
  rooms: RoomInfo[];
}

// 방 입장 응답(S→C, /user/queue/roomJoined). youAreHost로 수신자가 방장인지 알려준다(승계 통지 겸용).
// joinCode는 비공개 방일 때만 온다(방장이 친구에게 공유할 초대 코드).
export interface RoomJoinedMessage {
  roomId: string;
  name: string;
  mapId: string;
  state: RoomState;
  members: MemberInfo[];
  youAreHost: boolean;
  joinCode?: string;
}

// 방 상태/멤버 변경 브로드캐스트(S→C, /topic/room/{id}/state).
export interface RoomStateMessage {
  roomId: string;
  state: RoomState;
  members: MemberInfo[];
}

// 라운드 종료 결과(S→C, /topic/room/{id}/state, RoomStateMessage와 같은 채널). reason으로 구분.
export interface RoundEndMessage {
  roomId: string;
  reason: "DOMINATION" | "TIMEOUT";
  winnerHolderId: number;
  winnerName: string | null;
  leaderboard: { holderId: number; name: string; count: number }[];
}

// 방 생성(C→S, /app/lobby/create). 생성 즉시 생성자가 그 방에 입장한다. idToken은 JoinMessage 참고.
// private=true면 로비 목록에 안 뜨는 친구 초대 전용 방 — 서버가 초대 코드를 발급해 roomJoined로 돌려준다.
export interface CreateRoomCommand {
  name: string;
  mapId: string; // data/loadMapData.ts MAP_ASSETS 키. 서버가 모르는 값이면 기본 지도로 대체.
  nickname: string;
  token?: string;
  idToken?: string;
  clientId?: string; // 영속 클라 신원(방장 판정용)
  private?: boolean;
}

// 방 입장(C→S, /app/lobby/join). idToken은 JoinMessage 참고.
export interface JoinRoomCommand {
  roomId: string;
  nickname: string;
  token?: string;
  idToken?: string;
  clientId?: string; // 영속 클라 신원(재접속 시 방장·멤버 동일성 유지용)
}

// 초대 코드로 비공개 방 입장(C→S, /app/lobby/joinByCode).
export interface JoinByCodeCommand {
  code: string;
  nickname: string;
  token?: string;
  idToken?: string;
  clientId?: string;
}

// ── 친구 접속 현황 · 초대(로그인 유저 전용) ─────────────────────────────

// "나 접속했어"(C→S, /app/friends/hello). 로비 진입·친구 패널 열 때. 응답은 FriendPresenceMessage.
export interface HelloCommand {
  idToken?: string;
}

// 친구를 지금 내 방으로 초대(C→S, /app/friends/invite). 상대에게 InviteMessage가 푸시된다.
export interface InviteCommand {
  idToken?: string;
  targetAppUserId: number;
}

// 접속 중인 친구 하나. roomId가 없으면 로비에 있는 것(따라갈 방이 없음).
export interface FriendPresence {
  appUserId: number;
  nickname: string;
  roomId?: string;
  roomName?: string;
}

// 접속 중인 내 친구 목록(S→C, /user/queue/friendPresence).
export interface FriendPresenceMessage {
  friends: FriendPresence[];
}

// 친구가 나를 방으로 부름(S→C, /user/queue/invite). 수락 시 joinCode가 있으면 그걸로(비공개),
// 없으면 roomId로 입장한다.
export interface InviteMessage {
  fromNickname: string;
  roomId: string;
  roomName: string;
  joinCode?: string;
}
