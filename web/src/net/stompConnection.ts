// 실서버(Spring Boot/STOMP) 연결. docs/api-spec.md의 destination/메시지 그대로 사용한다.
// localConnection.ts(브라우저 내 목 서버)와 같은 Connection 계약을 구현하므로
// App.tsx에서 생성자만 바꿔 끼우면 된다(architecture.md §2.3 "실서버 전환").

import { Client, type IMessage } from "@stomp/stompjs";
import type { Connection } from "./connection";
import type { DeltaMessage, ErrorMessage, LeaderboardMessage, WelcomeMessage } from "./protocol";
import type { Order } from "../game/types";

// 서버 WebSocketConfig가 .withSockJS()로 등록했지만, /ws/websocket 서브패스는
// SockJS가 감싸지 않은 순수 WebSocket 전송이라 STOMP 프레임을 그대로 주고받을 수 있다
// (브라우저 sockjs-client 의존성 없이 네이티브 WebSocket만으로 연결 가능).
function defaultWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  // Vite dev 서버(5173)에서 띄운 경우만 서버 기본 포트(8080)를 가정한다.
  // 배포 후(plan.md Day5, Spring이 정적 빌드를 같은 origin으로 서빙)에는 포트를 건드리지 않는다.
  const isViteDev = window.location.port === "5173";
  const host = isViteDev ? `${window.location.hostname}:8080` : window.location.host;
  return `${protocol}://${host}/ws/websocket`;
}

// import.meta.env.VITE_WS_URL로 오버라이드 가능(다른 서버 주소로 붙여야 할 때).
export const SERVER_WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? defaultWsUrl();

export class StompConnection implements Connection {
  private client: Client;
  private nickname = "";
  private token: string | undefined;

  // api-spec.md §3 — 서버 epoch(ms) 기준 시각과 로컬 performance.now()의 1회 추정 오프셋.
  // serverTime ≈ localPerfNow + offsetMs. Order.departTick/arriveTick(서버 값)을 클라의
  // rAF 시간축(performance.now() 기반, MapView.tsx loop의 now)으로 맞추는 데만 쓴다.
  private offsetMs = 0;
  private offsetReady = false;

  private welcomeCb: ((m: WelcomeMessage) => void) | null = null;
  private deltaCb: ((m: DeltaMessage) => void) | null = null;
  private errorCb: ((m: ErrorMessage) => void) | null = null;
  private leaderboardCb: ((m: LeaderboardMessage) => void) | null = null;

  constructor(wsUrl: string = SERVER_WS_URL) {
    this.client = new Client({
      brokerURL: wsUrl,
      reconnectDelay: 3000, // 끊기면 3초 후 자동 재연결(plan.md §6 네트워크 불안 대응)
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
    });

    // 최초 연결이든 자동 재연결이든, 연결될 때마다 구독을 다시 걸고 JOIN을 재전송한다.
    // (재연결 = 새 WebSocket 세션 = 서버 Principal도 새로 발급되므로, 저장해둔 token으로
    //  다시 JOIN해야 같은 holderId로 복구된다 — api-spec.md §2.1 재접속 규칙 그대로.)
    this.client.onConnect = () => this.subscribeAndJoin();
  }

  join(nickname: string, token?: string): void {
    this.nickname = nickname;
    this.token = token;
    if (this.client.active) return; // 이미 활성화됨(재연결은 onConnect가 알아서 처리)
    this.client.activate();
  }

  private subscribeAndJoin(): void {
    this.client.subscribe("/user/queue/welcome", (msg: IMessage) => {
      this.handleWelcome(JSON.parse(msg.body) as WelcomeMessage);
    });
    this.client.subscribe("/user/queue/error", (msg: IMessage) => {
      this.errorCb?.(JSON.parse(msg.body) as ErrorMessage);
    });
    this.client.subscribe("/topic/world", (msg: IMessage) => {
      this.handleDelta(JSON.parse(msg.body) as DeltaMessage);
    });
    this.client.subscribe("/topic/leaderboard", (msg: IMessage) => {
      this.leaderboardCb?.(JSON.parse(msg.body) as LeaderboardMessage);
    });
    this.client.publish({
      destination: "/app/join",
      body: JSON.stringify({ nickname: this.nickname, token: this.token }),
    });
  }

  sendSortie(from: number, to: number, ratio: number): void {
    this.client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio }) });
  }

  sendMissile(center: [number, number], radius: number, hits: number[]): void {
    this.client.publish({ destination: "/app/missile", body: JSON.stringify({ center, radius, hits }) });
  }

  private handleWelcome(raw: WelcomeMessage): void {
    this.token = raw.token; // 재접속(자동 재연결 포함) 시 서버가 발급한 최신 토큰을 계속 사용
    this.offsetMs = raw.serverTimeMs - performance.now();
    this.offsetReady = true;
    this.welcomeCb?.({ ...raw, orders: raw.orders.map((o) => this.toLocalOrder(o)) });
  }

  private handleDelta(raw: DeltaMessage): void {
    this.deltaCb?.({ ...raw, newOrders: raw.newOrders.map((o) => this.toLocalOrder(o)) });
  }

  // 서버 epoch(ms) → 로컬 performance.now() 시간축. 오프셋 계산 전(이례적 케이스)엔 그대로 통과.
  private toLocalOrder(o: Order): Order {
    if (!this.offsetReady) return o;
    return { ...o, departTick: o.departTick - this.offsetMs, arriveTick: o.arriveTick - this.offsetMs };
  }

  onWelcome(cb: (m: WelcomeMessage) => void): void {
    this.welcomeCb = cb;
  }
  onDelta(cb: (m: DeltaMessage) => void): void {
    this.deltaCb = cb;
  }
  onError(cb: (m: ErrorMessage) => void): void {
    this.errorCb = cb;
  }
  onLeaderboard(cb: (m: LeaderboardMessage) => void): void {
    this.leaderboardCb = cb;
  }

  dispose(): void {
    void this.client.deactivate();
  }
}
