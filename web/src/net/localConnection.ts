// 브라우저 내 "목 서버". core.ts(순수 도메인 로직)를 감싸 서버 tick 루프를 돌리고,
// api-spec.md의 WELCOME/DELTA/LEADERBOARD/ERROR 메시지를 발신한다.
// 실제 Spring 서버가 생기면 이 클래스를 StompConnection으로 교체만 하면 된다
// (Connection 인터페이스는 그대로) — 클라 렌더러/입력 계층은 바뀌지 않는다.

import * as core from "../game/core";
import type { PreparedMap } from "../data/loadDong";
import { CONFIG, MY_HOLDER_ID } from "../config";
import type { Order } from "../game/types";
import type { Connection } from "./connection";
import type {
  DeltaMessage,
  ErrorMessage,
  LeaderboardMessage,
  WelcomeMessage,
} from "./protocol";

const TICK_MS = 200; // 서버 tick = DELTA 주기 (5Hz)
const LEADERBOARD_EVERY = 5; // tick 5회마다 = 1Hz

export class LocalConnection implements Connection {
  private gs: core.GameState;
  private holderId = MY_HOLDER_ID; // 목업은 단일 로컬 플레이어
  private token = "";

  private welcomeCb: ((m: WelcomeMessage) => void) | null = null;
  private deltaCb: ((m: DeltaMessage) => void) | null = null;
  private errorCb: ((m: ErrorMessage) => void) | null = null;
  private leaderboardCb: ((m: LeaderboardMessage) => void) | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private tickCount = 0;
  private pendingOrders: Order[] = []; // 이번 DELTA 구간에 새로 발주된 이동 유닛
  private lastSentLogId = 0;

  constructor(private prepared: PreparedMap) {
    // core가 유일한 진실. 시작 동 배정 = 데이터 무게중심 근처(목업).
    const startIndex = core.pickStartIndex(prepared.meta);
    this.gs = core.createGameState(
      prepared.n,
      prepared.neighborIndex,
      prepared.meta,
      startIndex,
      Date.now()
    );
  }

  join(nickname: string, token?: string): void {
    this.token = token && token.length > 0 ? token : crypto.randomUUID();
    const holder = this.gs.holders.get(this.holderId);
    if (holder && nickname.trim()) holder.name = nickname.trim().slice(0, 12);

    this.welcomeCb?.(this.buildWelcome());

    // 목 서버 tick 루프 시작.
    this.lastTickMs = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  sendSortie(from: number, to: number): void {
    const now = performance.now();
    const before = this.gs.orders.length;
    const res = core.trySortie(this.gs, from, to, this.holderId, now);
    if (!res.ok) {
      this.errorCb?.({ code: this.errorCode(from, to), message: res.reason, from, to });
      return;
    }
    // 성공 시 방금 push된 order를 다음 DELTA에 실어 보낸다.
    if (this.gs.orders.length > before) {
      this.pendingOrders.push(this.gs.orders[this.gs.orders.length - 1]);
    }
  }

  // core의 검증 순서(소유 → 인접 → 병력)를 그대로 재현해 ERROR code를 도출.
  private errorCode(from: number, to: number): ErrorMessage["code"] {
    if (this.gs.ownerId[from] !== this.holderId) return "NOT_OWNER";
    if (!this.gs.neighborIndex[from]?.includes(to)) return "NOT_ADJACENT";
    return "NO_TROOPS";
  }

  private tick(): void {
    const now = performance.now();
    const wall = Date.now();
    const dt = (now - this.lastTickMs) / 1000;
    this.lastTickMs = now;

    core.tickProduction(this.gs, dt);
    core.tickOrders(this.gs, now, wall); // 도착 유닛 전투 처리(dirty·log 갱신)

    this.flushDelta(now);

    this.tickCount++;
    if (this.tickCount % LEADERBOARD_EVERY === 0) this.flushLeaderboard();
  }

  private flushDelta(now: number): void {
    const changed = core.drainDirty(this.gs);
    const cells = changed.map(
      (i) => [i, this.gs.ownerId[i], this.gs.troops[i]] as [number, number, number]
    );
    const newOrders = this.pendingOrders;
    this.pendingOrders = [];

    // 새 로그(id > 마지막 전송분)만. logEntries는 최신순(prepend)이라 그대로 실어 보낸다.
    const events = this.gs.logEntries.filter((e) => e.id > this.lastSentLogId);
    if (events.length > 0) this.lastSentLogId = events[0].id; // 최신 = 배열 첫 원소

    if (cells.length === 0 && newOrders.length === 0 && events.length === 0) return;
    this.deltaCb?.({ serverTimeMs: now, cells, newOrders, events });
  }

  private flushLeaderboard(): void {
    const rows = core.getLeaderboard(this.gs); // 중립 제외 (E는 Day 3에서 별도 제외)
    let envCells = 0;
    for (let i = 0; i < this.gs.n; i++) {
      if (this.gs.ownerId[i] === CONFIG.ENV_HOLDER_ID) envCells++;
    }
    this.leaderboardCb?.({ rows, envCells, totalCells: this.gs.n });
  }

  private buildWelcome(): WelcomeMessage {
    return {
      holderId: this.holderId,
      token: this.token,
      serverTimeMs: performance.now(),
      config: CONFIG,
      meta: this.prepared.meta,
      neighborIndex: this.prepared.neighborIndex,
      ownerId: Array.from(this.gs.ownerId),
      troops: Array.from(this.gs.troops),
      troopCap: Array.from(this.gs.troopCap),
      holders: Array.from(this.gs.holders.values()),
      orders: this.gs.orders.slice(),
    };
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
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
