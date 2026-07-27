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
  // B1 경로 자동 출정. to는 인접이 아니어도 됨 — 서버가 내 영토를 따라 최단 경로로 연쇄 출정한다.
  sendMarch(from: number, to: number, ratio: number): void;
  // 미사일 발사. center=원 중심[lng,lat], radius=반경(도), hits=원에 겹치는 동 admIndex(클라 계산).
  sendMissile(center: [number, number], radius: number, hits: number[]): void;
  // B2 집결지 지정/해제. index = 내 소유 admIndex, -1이면 해제. 이후 후방 병력이 이 동으로 자동 전진.
  sendRally(index: number): void;
  // B3 공수부대(병력 수송). sources = 원 안 내 소유 동 admIndex(클라 계산), dest = 투하 목적지(인접 불필요).
  sendAirdrop(sources: number[], dest: number): void;
  // 궤멸(소유 동 0개) 후 재시작 요청. 아직 소유 동이 있으면 서버가 무시한다.
  sendRestart(): void;

  // 서버 → 클라 이벤트 구독. 각 1개 콜백만 등록(단순화).
  onWelcome(cb: (msg: WelcomeMessage) => void): void;
  onDelta(cb: (msg: DeltaMessage) => void): void;
  onError(cb: (msg: ErrorMessage) => void): void;
  onLeaderboard(cb: (msg: LeaderboardMessage) => void): void;
  // 연결 상태 변화(true=연결/재연결됨, false=끊김). 실서버(STOMP)만 실제로 끊김을 알린다.
  // 목 서버는 항상 연결 상태라 join 시 true만 통지한다.
  onConnectionChange(cb: (connected: boolean) => void): void;

  // 연결 종료(타이머·리스너 정리).
  dispose(): void;
}
