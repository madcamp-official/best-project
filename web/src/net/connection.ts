// 클라이언트가 "서버"와 대화하는 유일한 창구. 렌더러/입력 계층은 이 인터페이스만 알고,
// 뒤에 실제 STOMP 서버가 있는지(localConnection의 브라우저 내 목 서버인지) 모른다.
// plan.md §3 — 클라는 렌더러 + 입력 전송기. 로직은 서버(여기서는 목 서버) 하나에만.

import type {
  DeltaMessage,
  ErrorMessage,
  FriendPresenceMessage,
  InviteMessage,
  LeaderboardMessage,
  RoomJoinedMessage,
  RoomListMessage,
  RoomStateMessage,
  RoundEndMessage,
  WelcomeMessage,
} from "./protocol";

export interface Connection {
  // 접속(또는 재접속). token이 있으면 기존 holder 복구 시도. (레거시 브리지/목업 솔로 진입점)
  // idToken(구글 로그인, feat/google-login) — 있으면 서버가 검증 후 그 계정의 닉네임을 우선한다.
  join(nickname: string, token?: string, idToken?: string): void;

  // ── 로비/방(다중 세션) ──
  // 공개 방 목록 요청 → onRoomList로 응답(/topic/rooms).
  listRooms(): void;
  // 방 생성(생성 즉시 입장). onRoomJoined로 응답. mapId = data/loadMapData.ts MAP_ASSETS 키.
  // isPrivate=true면 로비 목록에 안 뜨고 서버가 초대 코드를 발급한다(onRoomJoined의 joinCode로 옴 — 친구에게 공유).
  createRoom(name: string, mapId: string, nickname: string, token?: string, idToken?: string, isPrivate?: boolean): void;
  // 방 입장. onRoomJoined로 응답(진행 중 방이면 onWelcome도).
  joinRoom(roomId: string, nickname: string, token?: string, idToken?: string): void;
  // 초대 코드로 비공개 방 입장. onRoomJoined로 응답(코드가 틀리면 onError ROOM_NOT_FOUND).
  joinByCode(code: string, nickname: string, token?: string, idToken?: string): void;
  // 방 안에서 라운드 시작(방장 전용 — 방장 제외 전원 준비 시). 성공 시 onWelcome(전원) + onRoomState(PLAYING).
  startRound(): void;
  // 대기실 준비 토글(방장 아닌 멤버). 결과는 onRoomState의 멤버 ready로 전원에 퍼진다.
  setReady(ready: boolean): void;
  // 현재 방에서 나가 로비로.
  leaveRoom(): void;

  // ── 친구 접속 현황 · 초대(로그인 유저 전용) ──
  // "나 접속했어, 친구들 어디 있어?" — 로비 진입·친구 패널 열 때. 응답은 onFriendPresence.
  // 이 호출이 곧 접속 등록이라, 로비에 가만히 있어도 친구 초대를 받을 수 있게 된다.
  sendFriendsHello(idToken: string): void;
  // 친구를 지금 내가 있는 방으로 부른다. 상대 화면에 onInvite로 알림이 뜬다.
  sendFriendInvite(idToken: string, targetAppUserId: number): void;

  // 출정/이동 명령 전송. ratio = 이번 출정에 보낼 병력 비율(0~1, UI 슬라이더). amount는 서버가 계산.
  sendSortie(from: number, to: number, ratio: number): void;
  // B1 경로 자동 출정. to는 인접이 아니어도 됨 — 서버가 내 영토를 따라 최단 경로로 연쇄 출정한다.
  sendMarch(from: number, to: number, ratio: number): void;
  // 드래그 쓸기. 한 출발지에서 여러 인접 목표로 병력을 균등 분할해 동시 출정한다.
  sendMultiSortie(from: number, targets: number[], ratio: number): void;
  // 미사일 발사. center=원 중심[lng,lat], radius=반경(도), hits=원에 겹치는 동 admIndex(클라 계산).
  sendMissile(center: [number, number], radius: number, hits: number[]): void;
  // 전술핵 발사(사일로 소유자 전용). 인자 형식은 sendMissile과 동일하되 반경이 NUKE_RADIUS_MULT배.
  sendNuke(center: [number, number], radius: number, hits: number[]): void;
  // 공격 큐 토글. index = 국경에 인접한 적·중립 admIndex. 이미 큐에 있으면 해제, 없으면 추가.
  // 이후 매 주기 그 대상에 인접한 내 동들이 자동 공격하고, 후방 병력도 가장 가까운 대상으로 자동 전진한다.
  sendAttackTarget(index: number): void;
  // B3 공수부대(병력 수송). sources = 원 안 내 소유 동 admIndex(클라 계산), dest = 투하 목적지(인접 불필요).
  sendAirdrop(sources: number[], dest: number): void;
  // 궤멸(소유 동 0개) 후 재시작 요청. 아직 소유 동이 있으면 서버가 무시한다.
  sendRestart(): void;

  // 서버 → 클라 이벤트 구독. 각 1개 콜백만 등록(단순화).
  onWelcome(cb: (msg: WelcomeMessage) => void): void;
  onDelta(cb: (msg: DeltaMessage) => void): void;
  onError(cb: (msg: ErrorMessage) => void): void;
  onLeaderboard(cb: (msg: LeaderboardMessage) => void): void;
  // 로비/방 이벤트 구독.
  onRoomList(cb: (msg: RoomListMessage) => void): void;
  onRoomJoined(cb: (msg: RoomJoinedMessage) => void): void;
  onRoomState(cb: (msg: RoomStateMessage) => void): void;
  onRoundEnd(cb: (msg: RoundEndMessage) => void): void;
  // 접속 중인 친구 목록 갱신(sendFriendsHello/초대 후 서버가 돌려줌).
  onFriendPresence(cb: (msg: FriendPresenceMessage) => void): void;
  // 친구가 나를 방으로 초대함 — 배너를 띄우고 수락하면 그 방으로 들어간다.
  onInvite(cb: (msg: InviteMessage) => void): void;
  // 연결 상태 변화(true=연결/재연결됨, false=끊김). 실서버(STOMP)만 실제로 끊김을 알린다.
  // 목 서버는 항상 연결 상태라 join 시 true만 통지한다.
  onConnectionChange(cb: (connected: boolean) => void): void;

  // 연결 종료(타이머·리스너 정리).
  dispose(): void;
}
