// 브라우저 내 "목 서버". core.ts(순수 도메인 로직)를 감싸 서버 tick 루프를 돌리고,
// api-spec.md의 WELCOME/DELTA/LEADERBOARD/ERROR 메시지를 발신한다.
// 실제 Spring 서버가 생기면 이 클래스를 StompConnection으로 교체만 하면 된다
// (Connection 인터페이스는 그대로) — 클라 렌더러/입력 계층은 바뀌지 않는다.

import * as core from "../game/core";
import type { PreparedMap } from "../data/loadDong";
import { CONFIG, ENV_PALETTE_IDX, MY_HOLDER_ID, NEUTRAL_HOLDER_ID } from "../config";
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
const SAVE_EVERY = 10; // tick 10회마다 = 2s 간격으로 월드 스냅샷 저장
const WORLD_KEY = "world-snapshot"; // 재접속 복구용 (실서버라면 서버 메모리/파일에 있음)

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
  private startIndex: number;
  private envTimerMs = 0; // 환경 세력 행동 주기 누산기
  private prepared: PreparedMap;

  constructor(prepared: PreparedMap) {
    this.prepared = prepared;
    // core가 유일한 진실. 시작 동 배정 = 데이터 무게중심 근처(목업).
    this.startIndex = core.pickStartIndex(prepared.meta);
    this.gs = core.createGameState(
      prepared.n,
      prepared.neighborIndex,
      prepared.meta,
      this.startIndex,
      Date.now()
    );
    // 재접속: 저장된 월드가 있으면 복구, 없으면 새 게임(E 스폰).
    // (실서버는 서버 메모리의 월드를 유지 — 여기선 localStorage가 그 역할을 대신한다.)
    if (!this.restoreWorld()) {
      core.envSpawn(this.gs, this.pickEnvCells(), ENV_PALETTE_IDX, Date.now());
    }
  }

  private restoreWorld(): boolean {
    try {
      const raw = localStorage.getItem(WORLD_KEY);
      if (!raw) return false;
      const snap = JSON.parse(raw) as {
        n: number;
        ownerId: number[];
        troops: number[];
        holders: { id: number; name: string; paletteIdx: number }[];
        nextLogId: number;
      };
      if (!snap || snap.n !== this.gs.n || !Array.isArray(snap.ownerId)) return false;
      this.gs.ownerId = Uint8Array.from(snap.ownerId);
      this.gs.troops = Uint16Array.from(snap.troops);
      this.gs.holders = new Map(snap.holders.map((h) => [h.id, h]));
      this.gs.nextLogId = snap.nextLogId ?? 1;
      return true;
    } catch {
      return false;
    }
  }

  private saveWorld(): void {
    try {
      localStorage.setItem(
        WORLD_KEY,
        JSON.stringify({
          n: this.gs.n,
          ownerId: Array.from(this.gs.ownerId),
          troops: Array.from(this.gs.troops),
          holders: Array.from(this.gs.holders.values()),
          nextLogId: this.gs.nextLogId,
        })
      );
    } catch {
      // localStorage 용량 초과 등은 조용히 무시(다음 저장에서 재시도).
    }
  }

  // 플레이어 시작 동에서 BFS로 ~4홉 떨어진 씨앗 + 인접 중립 동으로 E 시작 클러스터를 만든다.
  // (README §4.6 "외곽 스폰"의 데모 절충 — 중앙 시작이라 근처 링에 둬야 초반에 조우한다.)
  private pickEnvCells(): number[] {
    const { neighborIndex, n } = this.prepared;
    const dist = new Int32Array(n).fill(-1);
    const q: number[] = [this.startIndex];
    dist[this.startIndex] = 0;
    let seed = -1;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      if (seed < 0 && dist[cur] >= 4) seed = cur;
      for (const nb of neighborIndex[cur]) {
        if (dist[nb] === -1) {
          dist[nb] = dist[cur] + 1;
          q.push(nb);
        }
      }
    }
    if (seed < 0) seed = q.length > 1 ? q[q.length - 1] : this.startIndex;

    const cells = [seed];
    for (const nb of neighborIndex[seed]) {
      if (cells.length >= CONFIG.ENV_START_CELLS) break;
      if (this.gs.ownerId[nb] === NEUTRAL_HOLDER_ID) cells.push(nb);
    }
    return cells;
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

    // 환경 세력 행동 (ENV_ACT_INTERVAL_SEC 주기)
    this.envTimerMs += TICK_MS;
    if (this.envTimerMs >= CONFIG.ENV_ACT_INTERVAL_SEC * 1000) {
      this.envTimerMs = 0;
      const envOrder = core.tickEnv(this.gs, now);
      if (envOrder) this.pendingOrders.push(envOrder);
    }

    this.flushDelta(now);

    this.tickCount++;
    if (this.tickCount % LEADERBOARD_EVERY === 0) this.flushLeaderboard();
    if (this.tickCount % SAVE_EVERY === 0) this.saveWorld(); // 재접속 복구용 스냅샷
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
