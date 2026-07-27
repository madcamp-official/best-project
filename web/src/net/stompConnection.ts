// 실서버(Spring Boot/STOMP) 연결. docs/api-spec.md의 destination/메시지 그대로 사용한다.
// localConnection.ts(브라우저 내 목 서버)와 같은 Connection 계약을 구현하므로
// App.tsx에서 생성자만 바꿔 끼우면 된다(architecture.md §2.3 "실서버 전환").
//
// 다중 방(로비): 방 목록/생성/입장은 로비 채널로, 라운드 진행은 룸 스코프 토픽으로 받는다.
// 룸 구독은 currentRoomId 하나로 결정적으로 관리하고(중복 구독 가드), 재접속 시 그 방을 다시
// 구독하고 재입장을 재발행해 원래 방으로 복구한다.

import { Client, type IMessage, type StompSubscription } from "@stomp/stompjs";
import type { Connection } from "./connection";
import type {
  DeltaMessage,
  ErrorMessage,
  LeaderboardMessage,
  RoomJoinedMessage,
  RoomListMessage,
  RoomStateMessage,
  RoundEndMessage,
  WelcomeMessage,
} from "./protocol";
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
  // 구글 로그인(feat/google-login) ID 토큰 — 재연결 시 reestablish()가 다시 실어 보낸다.
  private idToken: string | undefined;

  // 접속 의도(재접속 시 복구용): 레거시 브리지(join)인지, 특정 방(joinRoom)인지.
  private bridgeMode = false;
  private currentRoomId: string | null = null;
  private roomSubs: StompSubscription[] = [];
  private subscribedRoomId: string | null = null;
  // 연결 전에 쌓인 일회성 명령(list/create/start/leave 등) — 연결되면 한 번 흘려보낸다.
  private pending: { destination: string; body: string }[] = [];

  // api-spec.md §3 — 서버 epoch(ms) 기준 시각과 로컬 performance.now()의 1회 추정 오프셋.
  private offsetMs = 0;
  private offsetReady = false;

  private welcomeCb: ((m: WelcomeMessage) => void) | null = null;
  private deltaCb: ((m: DeltaMessage) => void) | null = null;
  private errorCb: ((m: ErrorMessage) => void) | null = null;
  private leaderboardCb: ((m: LeaderboardMessage) => void) | null = null;
  private roomListCb: ((m: RoomListMessage) => void) | null = null;
  private roomJoinedCb: ((m: RoomJoinedMessage) => void) | null = null;
  private roomStateCb: ((m: RoomStateMessage) => void) | null = null;
  private roundEndCb: ((m: RoundEndMessage) => void) | null = null;
  private connectionCb: ((connected: boolean) => void) | null = null;

  constructor(wsUrl: string = SERVER_WS_URL) {
    this.client = new Client({
      brokerURL: wsUrl,
      reconnectDelay: 3000, // 끊기면 3초 후 자동 재연결(plan.md §6 네트워크 불안 대응)
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
    });

    this.client.onConnect = () => {
      // 재연결 = 새 세션이라 기존 구독 핸들은 죽었다 — 상태를 비우고 처음부터 다시 건다.
      this.roomSubs = [];
      this.subscribedRoomId = null;
      this.subscribeCommon();
      this.flushPending();
      this.reestablish(); // 접속 의도(브리지/방)를 서버에 재확립
      this.connectionCb?.(true);
    };
    this.client.onWebSocketClose = () => this.connectionCb?.(false);
    this.client.onStompError = () => this.connectionCb?.(false);
  }

  // ── 공통/로비 구독 ──
  private subscribeCommon(): void {
    this.client.subscribe("/user/queue/welcome", (m: IMessage) =>
      this.handleWelcome(JSON.parse(m.body) as WelcomeMessage),
    );
    this.client.subscribe("/user/queue/error", (m: IMessage) =>
      this.errorCb?.(JSON.parse(m.body) as ErrorMessage),
    );
    this.client.subscribe("/user/queue/roomJoined", (m: IMessage) =>
      this.handleRoomJoined(JSON.parse(m.body) as RoomJoinedMessage),
    );
    this.client.subscribe("/topic/rooms", (m: IMessage) =>
      this.roomListCb?.(JSON.parse(m.body) as RoomListMessage),
    );
  }

  // 방 스코프 토픽(world/leaderboard/state) 구독 — 같은 방이면 재구독하지 않는다.
  private subscribeRoom(roomId: string): void {
    if (this.subscribedRoomId === roomId) return;
    this.unsubscribeRoom();
    this.roomSubs = [
      this.client.subscribe(`/topic/room/${roomId}/world`, (m: IMessage) =>
        this.handleDelta(JSON.parse(m.body) as DeltaMessage),
      ),
      this.client.subscribe(`/topic/room/${roomId}/leaderboard`, (m: IMessage) =>
        this.leaderboardCb?.(JSON.parse(m.body) as LeaderboardMessage),
      ),
      this.client.subscribe(`/topic/room/${roomId}/state`, (m: IMessage) =>
        this.handleRoomState(JSON.parse(m.body)),
      ),
    ];
    this.subscribedRoomId = roomId;
  }

  private unsubscribeRoom(): void {
    for (const s of this.roomSubs) {
      try {
        s.unsubscribe();
      } catch {
        // 죽은 세션의 핸들 — 무시
      }
    }
    this.roomSubs = [];
    this.subscribedRoomId = null;
  }

  private ensureActive(): void {
    if (!this.client.active) this.client.activate();
  }

  private flushPending(): void {
    const queued = this.pending;
    this.pending = [];
    for (const p of queued) this.client.publish(p);
  }

  // 연결됐으면 즉시 발행, 아니면 큐에 쌓아 다음 연결에서 한 번 흘려보낸다(일회성 명령용).
  private send(destination: string, body: string): void {
    this.ensureActive();
    if (this.client.connected) this.client.publish({ destination, body });
    else this.pending.push({ destination, body });
  }

  // 접속 의도를 서버에 (재)확립 — 재연결 시 원래 방으로 복구되게 한다.
  private reestablish(): void {
    if (this.bridgeMode) {
      if (this.currentRoomId) this.subscribeRoom(this.currentRoomId);
      this.client.publish({
        destination: "/app/join",
        body: JSON.stringify({ nickname: this.nickname, token: this.token, idToken: this.idToken }),
      });
    } else if (this.currentRoomId) {
      this.subscribeRoom(this.currentRoomId);
      this.client.publish({
        destination: "/app/lobby/join",
        body: JSON.stringify({
          roomId: this.currentRoomId,
          nickname: this.nickname,
          token: this.token,
          idToken: this.idToken,
        }),
      });
    }
  }

  // ── Connection: 접속/로비 ──
  join(nickname: string, token?: string, idToken?: string): void {
    this.nickname = nickname;
    this.token = token;
    this.idToken = idToken;
    this.bridgeMode = true;
    this.currentRoomId = null;
    this.ensureActive();
    if (this.client.connected) this.reestablish();
  }

  listRooms(): void {
    this.send("/app/lobby/list", "{}");
  }

  createRoom(name: string, nickname: string, token?: string, idToken?: string): void {
    this.nickname = nickname;
    this.token = token;
    this.idToken = idToken;
    this.bridgeMode = false;
    this.send("/app/lobby/create", JSON.stringify({ name, nickname, token, idToken }));
  }

  joinRoom(roomId: string, nickname: string, token?: string, idToken?: string): void {
    this.nickname = nickname;
    this.token = token;
    this.idToken = idToken;
    this.bridgeMode = false;
    this.currentRoomId = roomId;
    this.ensureActive();
    if (this.client.connected) this.reestablish();
  }

  startRound(): void {
    this.send("/app/room/start", "{}");
  }

  setReady(ready: boolean): void {
    this.send("/app/room/ready", JSON.stringify({ ready }));
  }

  leaveRoom(): void {
    this.send("/app/room/leave", "{}");
    this.unsubscribeRoom();
    this.currentRoomId = null;
    this.bridgeMode = false;
  }

  // ── Connection: 게임 액션(방 진행 중, 항상 연결 상태 전제) ──
  sendSortie(from: number, to: number, ratio: number): void {
    this.client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio }) });
  }

  sendMarch(from: number, to: number, ratio: number): void {
    this.client.publish({ destination: "/app/march", body: JSON.stringify({ from, to, ratio }) });
  }

  sendMissile(center: [number, number], radius: number, hits: number[]): void {
    this.client.publish({ destination: "/app/missile", body: JSON.stringify({ center, radius, hits }) });
  }

  sendRally(index: number): void {
    this.client.publish({ destination: "/app/rally", body: JSON.stringify({ index }) });
  }

  sendAirdrop(sources: number[], dest: number): void {
    this.client.publish({ destination: "/app/airdrop", body: JSON.stringify({ sources, dest }) });
  }

  sendRestart(): void {
    this.client.publish({ destination: "/app/restart", body: "{}" });
  }

  // ── 서버 → 클라 핸들러 ──
  private handleWelcome(raw: WelcomeMessage): void {
    this.token = raw.token; // 재접속 시 서버가 발급한 최신 토큰을 계속 사용
    this.currentRoomId = raw.roomId; // 권위 있는 현재 방 — 룸 토픽 구독의 기준
    this.subscribeRoom(raw.roomId);
    this.offsetMs = raw.serverTimeMs - performance.now();
    this.offsetReady = true;
    this.welcomeCb?.({ ...raw, orders: raw.orders.map((o) => this.toLocalOrder(o)) });
  }

  private handleDelta(raw: DeltaMessage): void {
    this.deltaCb?.({ ...raw, newOrders: raw.newOrders.map((o) => this.toLocalOrder(o)) });
  }

  private handleRoomJoined(raw: RoomJoinedMessage): void {
    this.currentRoomId = raw.roomId;
    this.subscribeRoom(raw.roomId); // 대기 중에도 /state를 받기 위해 미리 구독
    this.roomJoinedCb?.(raw);
  }

  // /topic/room/{id}/state 채널로 RoomStateMessage와 RoundEndMessage가 함께 온다 — reason 유무로 구분.
  private handleRoomState(raw: unknown): void {
    if (raw && typeof raw === "object" && "reason" in raw) this.roundEndCb?.(raw as RoundEndMessage);
    else this.roomStateCb?.(raw as RoomStateMessage);
  }

  // 서버 epoch(ms) → 로컬 performance.now() 시간축. 오프셋 계산 전(이례적 케이스)엔 그대로 통과.
  private toLocalOrder(o: Order): Order {
    if (!this.offsetReady) return o;
    return { ...o, departTick: o.departTick - this.offsetMs, arriveTick: o.arriveTick - this.offsetMs };
  }

  // ── 콜백 등록 ──
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
  onRoomList(cb: (m: RoomListMessage) => void): void {
    this.roomListCb = cb;
  }
  onRoomJoined(cb: (m: RoomJoinedMessage) => void): void {
    this.roomJoinedCb = cb;
  }
  onRoomState(cb: (m: RoomStateMessage) => void): void {
    this.roomStateCb = cb;
  }
  onRoundEnd(cb: (m: RoundEndMessage) => void): void {
    this.roundEndCb = cb;
  }
  onConnectionChange(cb: (connected: boolean) => void): void {
    this.connectionCb = cb;
  }

  dispose(): void {
    void this.client.deactivate();
  }
}
