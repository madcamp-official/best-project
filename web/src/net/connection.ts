// 클라이언트가 "서버"와 대화하는 유일한 창구. 렌더러/입력 계층은 이 인터페이스만 알고,
// 뒤에 실제 STOMP 서버가 있는지(localConnection의 브라우저 내 목 서버인지) 모른다.
// plan.md §3 — 클라는 렌더러 + 입력 전송기. 로직은 서버(여기서는 목 서버) 하나에만.

import type {
  DeltaMessage,
  ErrorMessage,
  LeaderboardMessage,
  WelcomeMessage,
} from "./protocol";

export interface Connection {
  // 접속(또는 재접속). token이 있으면 기존 holder 복구 시도.
  join(nickname: string, token?: string): void;
  // 출정/이동 명령 전송. ratio = 이번 출정에 보낼 병력 비율(0~1, UI 슬라이더). amount는 서버가 계산.
  sendSortie(from: number, to: number, ratio: number): void;

  // 서버 → 클라 이벤트 구독. 각 1개 콜백만 등록(단순화).
  onWelcome(cb: (msg: WelcomeMessage) => void): void;
  onDelta(cb: (msg: DeltaMessage) => void): void;
  onError(cb: (msg: ErrorMessage) => void): void;
  onLeaderboard(cb: (msg: LeaderboardMessage) => void): void;

  // 연결 종료(타이머·리스너 정리).
  dispose(): void;
}
