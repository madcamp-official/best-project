// 브라우저 내 "목 서버". core.ts(순수 도메인 로직)를 감싸 서버 tick 루프를 돌리고,
// api-spec.md의 WELCOME/DELTA/LEADERBOARD/ERROR 메시지를 발신한다.
// 실제 Spring 서버가 생기면 이 클래스를 StompConnection으로 교체만 하면 된다
// (Connection 인터페이스는 그대로) — 클라 렌더러/입력 계층은 바뀌지 않는다.

import * as core from "../game/core";
import type { PreparedMap } from "../data/loadDong";
import { CONFIG, ENV_PALETTE_IDX, MY_HOLDER_ID, NEUTRAL_HOLDER_ID } from "../config";
import type { Order, ShieldInfo } from "../game/types";
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
  private connectionCb: ((connected: boolean) => void) | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private tickCount = 0;
  private pendingOrders: Order[] = []; // 이번 DELTA 구간에 새로 발주된 이동 유닛
  private lastSentLogId = 0;
  private startIndex: number;
  private envTimerMs = 0; // 환경 세력 행동 주기 누산기
  private missileTimerMs = 0; // 미사일 스폰 주기 누산기
  private supplyTimerMs = 0; // 보급선(B2) 흐름 주기 누산기
  private pendingMissileAdd: number[] = []; // 이번 DELTA 구간에 새로 스폰된 미사일 동
  private pendingMissileRemove: number[] = []; // 이번 DELTA 구간에 사라진 미사일 동(발사 소모)
  private pendingShields: ShieldInfo[] = []; // 이번 DELTA 구간에 새로 생기거나 갱신된 방어막(재시작)
  private pendingMissileImpacts: number[] = []; // 이번 DELTA 구간에 미사일이 착탄한 동(폭발 연출용)
  private lastEnclosedKey = ""; // 직전에 보낸 포위 동 집합의 키 — 바뀔 때만 DELTA에 enclosed를 싣는다
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
      Date.now(),
      prepared.borderMask // 포위 귀속 판정의 경계 동 마스크
    );
    // 개발 편의: 포위 귀속 등 시나리오 테스트를 위해 목 서버의 권위 상태·연결을 노출(프로덕션 제외).
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).__mockGs = this.gs;
      (globalThis as Record<string, unknown>).__mockConn = this;
    }
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

  // ENV_CLUSTER_COUNT개의 야만인 무리를 만든다. 각 무리 = 씨앗 1개 + 인접 중립 동
  // (무리당 ENV_START_CELLS개). 첫 씨앗은 플레이어 근처(초반 조우), 나머지는 전국에 고루 흩뿌린다.
  private pickEnvCells(): number[] {
    const seeds = this.pickEnvSeeds(Math.max(1, CONFIG.ENV_CLUSTER_COUNT));
    const cells = new Set<number>();
    for (const seed of seeds) {
      cells.add(seed);
      let inCluster = 1;
      for (const nb of this.prepared.neighborIndex[seed]) {
        if (inCluster >= CONFIG.ENV_START_CELLS) break;
        if (this.gs.ownerId[nb] === NEUTRAL_HOLDER_ID && !cells.has(nb)) {
          cells.add(nb);
          inCluster++;
        }
      }
    }
    return Array.from(cells);
  }

  // 무리 씨앗 선정: 1) 플레이어에서 ~4홉 떨어진 첫 씨앗, 2) 나머지는 최원점(farthest-point)
  // 샘플링으로 이미 고른 씨앗들에서 가장 먼 중립 동을 반복 선택 → 캠프들이 서로·플레이어와 떨어진다.
  private pickEnvSeeds(count: number): number[] {
    const { neighborIndex, n } = this.prepared;
    // 후보 = 인접 있는 중립 동(고립 섬 제외 — 거기 두면 자라지도 싸우지도 못한다).
    const usable = (i: number) =>
      this.gs.ownerId[i] === NEUTRAL_HOLDER_ID && neighborIndex[i].length > 0;

    const seeds: number[] = [this.pickNearPlayerSeed()];
    while (seeds.length < count) {
      let best = -1;
      let bestMinDist = -1;
      for (let i = 0; i < n; i++) {
        if (!usable(i) || seeds.includes(i)) continue;
        let minDist = Infinity; // 이미 고른 씨앗들과의 최소 제곱거리
        for (const s of seeds) {
          const d = this.centroidDistSq(i, s);
          if (d < minDist) minDist = d;
        }
        if (minDist > bestMinDist) {
          bestMinDist = minDist;
          best = i;
        }
      }
      if (best < 0) break; // 더 둘 곳이 없음
      seeds.push(best);
    }
    return seeds;
  }

  // 플레이어 시작 동에서 BFS로 ~4홉 떨어진 중립 씨앗 (중앙 시작이라 근처 링에 둬야 초반에 조우한다).
  private pickNearPlayerSeed(): number {
    const { neighborIndex, n } = this.prepared;
    const dist = new Int32Array(n).fill(-1);
    const q: number[] = [this.startIndex];
    dist[this.startIndex] = 0;
    let seed = -1;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      if (seed < 0 && dist[cur] >= 4 && this.gs.ownerId[cur] === NEUTRAL_HOLDER_ID) seed = cur;
      for (const nb of neighborIndex[cur]) {
        if (dist[nb] === -1) {
          dist[nb] = dist[cur] + 1;
          q.push(nb);
        }
      }
    }
    return seed >= 0 ? seed : q.length > 1 ? q[q.length - 1] : this.startIndex;
  }

  // 두 동 라벨 지점 사이 제곱거리(비교 전용이라 sqrt 생략).
  private centroidDistSq(a: number, b: number): number {
    const ca = this.prepared.meta[a].centroid;
    const cb = this.prepared.meta[b].centroid;
    const dx = ca[0] - cb[0];
    const dy = ca[1] - cb[1];
    return dx * dx + dy * dy;
  }

  join(nickname: string, token?: string): void {
    this.token = token && token.length > 0 ? token : crypto.randomUUID();
    const holder = this.gs.holders.get(this.holderId);
    if (holder && nickname.trim()) holder.name = nickname.trim().slice(0, 12);

    this.connectionCb?.(true); // 목 서버는 항상 연결 상태.
    this.welcomeCb?.(this.buildWelcome());

    // 목 서버 tick 루프 시작.
    this.lastTickMs = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  sendSortie(from: number, to: number, ratio: number): void {
    const now = performance.now();
    const before = this.gs.orders.length;
    // 클라가 보낸 비율은 신뢰하지 않고 안전 범위(0.05~1)로 클램프한다(실서버도 동일).
    const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : CONFIG.SORTIE_RATIO;
    const res = core.trySortie(this.gs, from, to, this.holderId, now, safeRatio);
    if (!res.ok) {
      this.errorCb?.({ code: this.errorCode(from, to), message: res.reason, from, to });
      return;
    }
    // 성공 시 방금 push된 order를 다음 DELTA에 실어 보낸다.
    if (this.gs.orders.length > before) {
      this.pendingOrders.push(this.gs.orders[this.gs.orders.length - 1]);
    }
  }

  sendMarch(from: number, to: number, ratio: number): void {
    const now = performance.now();
    const before = this.gs.orders.length;
    const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : CONFIG.SORTIE_RATIO;
    const res = core.tryMarch(this.gs, from, to, this.holderId, now, safeRatio);
    if (!res.ok) {
      this.errorCb?.({ code: "NO_PATH", message: res.reason, from, to });
      return;
    }
    if (this.gs.orders.length > before) {
      this.pendingOrders.push(this.gs.orders[this.gs.orders.length - 1]);
    }
  }

  sendMissile(center: [number, number], radius: number, hits: number[]): void {
    // 실서버와 동일 취지의 검증: 각 hit 동 centroid가 원 중심에서 radius+여유 안인지.
    const valid = hits.filter((h) => this.withinRadius(h, center, radius));
    const res = core.launchMissile(this.gs, this.holderId, valid, Date.now());
    if (!res.ok) {
      this.errorCb?.({ code: "NO_MISSILE", message: res.reason, from: -1, to: -1 });
      return;
    }
    this.pendingMissileRemove.push(res.removed); // 중립화된 동은 dirty로 cells에 실림
    // 착탄 동 전부(이미 중립이던 동 포함)를 실어 보낸다 — 소유권 변화가 없어도 폭발이 뜨게.
    this.pendingMissileImpacts.push(...res.neutralized);
  }

  sendRally(index: number): void {
    core.setRally(this.gs, this.holderId, index); // 다음 보급 tick부터 이 동을 향해 후방 병력 전진
  }

  // 궤멸(소유 동 0개) 상태에서 유저가 "재시작"을 눌렀을 때만 새 시작 동을 배정한다.
  sendRestart(): void {
    const ok = core.respawnPlayer(this.gs, this.holderId, Date.now()); // 다음 tick의 flushDelta로 dirty 전파
    if (ok) this.pendingShields.push({ holderId: this.holderId, until: this.gs.shieldUntil[this.holderId] });
  }

  sendAirdrop(sources: number[], dest: number): void {
    const now = performance.now();
    const before = this.gs.orders.length;
    const res = core.tryAirdrop(this.gs, sources, dest, this.holderId, now);
    if (!res.ok) {
      this.errorCb?.({ code: res.code, message: res.reason, from: -1, to: dest });
      return;
    }
    // 성공 시 방금 push된 삼각형 order를 다음 DELTA에 실어 보낸다(도착 시 flood 처리).
    if (this.gs.orders.length > before) {
      this.pendingOrders.push(this.gs.orders[this.gs.orders.length - 1]);
    }
  }

  // centroid 근접 검증(여유 큼 — centroid가 폴리곤 밖이어도 가장자리 걸침을 허용).
  private withinRadius(i: number, center: [number, number], radius: number): boolean {
    const c = this.gs.meta[i].centroid;
    const cosLat = Math.cos((center[1] * Math.PI) / 180);
    const dx = (c[0] - center[0]) * cosLat;
    const dy = c[1] - center[1];
    const lim = radius + 0.05;
    return dx * dx + dy * dy <= lim * lim;
  }

  // core의 검증 순서(소유 → 인접 → 병력)를 그대로 재현해 ERROR code를 도출.
  private errorCode(from: number, to: number): ErrorMessage["code"] {
    if (this.gs.ownerId[from] !== this.holderId) return "NOT_OWNER";
    if (!this.gs.neighborIndex[from]?.includes(to)) return "NOT_ADJACENT";
    if (this.gs.ownerId[to] === this.holderId && this.gs.troops[to] >= this.gs.troopCap[to])
      return "ALREADY_FULL";
    return "NO_TROOPS";
  }

  private tick(): void {
    const now = performance.now();
    const wall = Date.now();
    const dt = (now - this.lastTickMs) / 1000;
    this.lastTickMs = now;

    core.tickProduction(this.gs, dt);
    // 도착 유닛 전투/증원 처리. 경로 자동 출정(B1) 릴레이의 다음-홉 order는 반환되므로 DELTA에 싣는다.
    const relayLegs = core.tickOrders(this.gs, now, wall);
    if (relayLegs.length > 0) this.pendingOrders.push(...relayLegs);
    core.tickAnnex(this.gs, now, wall); // 포위 귀속 판정(흡수 시 dirty·log 갱신 → DELTA로 전파)

    // 환경 세력 행동 (ENV_ACT_INTERVAL_SEC 주기)
    this.envTimerMs += TICK_MS;
    if (this.envTimerMs >= CONFIG.ENV_ACT_INTERVAL_SEC * 1000) {
      this.envTimerMs = 0;
      const envOrder = core.tickEnv(this.gs, now);
      if (envOrder) this.pendingOrders.push(envOrder);
    }

    // 미사일 스폰 (MISSILE_SPAWN_SEC 주기)
    this.missileTimerMs += TICK_MS;
    if (this.missileTimerMs >= CONFIG.MISSILE_SPAWN_SEC * 1000) {
      this.missileTimerMs = 0;
      const spawned = core.trySpawnMissile(this.gs);
      if (spawned >= 0) this.pendingMissileAdd.push(spawned);
    }

    // 보급선 흐름 (SUPPLY_INTERVAL_SEC 주기) — 집결지 방향으로 후방 병력 한 홉 행군(B2)
    this.supplyTimerMs += TICK_MS;
    if (this.supplyTimerMs >= CONFIG.SUPPLY_INTERVAL_SEC * 1000) {
      this.supplyTimerMs = 0;
      const supplyOrders = core.tickSupply(this.gs, now);
      if (supplyOrders.length > 0) this.pendingOrders.push(...supplyOrders);
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

    const missileAdd = this.pendingMissileAdd;
    const missileRemove = this.pendingMissileRemove;
    const missileImpacts = this.pendingMissileImpacts;
    this.pendingMissileAdd = [];
    this.pendingMissileRemove = [];
    this.pendingMissileImpacts = [];

    const shieldUpdates = this.pendingShields;
    this.pendingShields = [];

    // 현재 포위(귀속 대기) 동 집합 — enclosedBy>=0인 동. 직전과 다를 때만 enclosed를 싣는다
    // (매 tick 전송 방지). 집합이 바뀌면 다른 변경이 없어도 DELTA를 강제해 반짝임이 즉시 갱신되게.
    const enclosedList: number[] = [];
    for (let i = 0; i < this.gs.n; i++) if (this.gs.enclosedBy[i] >= 0) enclosedList.push(i);
    const enclosedKey = enclosedList.join(",");
    const enclosedChanged = enclosedKey !== this.lastEnclosedKey;

    if (
      cells.length === 0 &&
      newOrders.length === 0 &&
      events.length === 0 &&
      missileAdd.length === 0 &&
      missileRemove.length === 0 &&
      missileImpacts.length === 0 &&
      shieldUpdates.length === 0 &&
      !enclosedChanged
    ) {
      return;
    }
    this.lastEnclosedKey = enclosedKey;
    // 목 서버는 단일 로컬 플레이어라 접속 중 새 holder가 생기는 시나리오가 없다 — 항상 빈 배열.
    this.deltaCb?.({
      serverTimeMs: now,
      cells,
      newOrders,
      events,
      missileAdd,
      missileRemove,
      missileImpacts,
      newHolders: [],
      shieldUpdates,
      ...(enclosedChanged ? { enclosed: enclosedList } : {}),
    });
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
      missiles: this.collectMissiles(),
      rally: this.gs.rally[this.holderId],
      shields: this.collectShields(),
    };
  }

  // 지금(Date.now() 기준) 활성 상태인 방어막 전체 스냅샷(만료분 제외). 표시(카운트다운)
  // 용도라 서버 offsetMs 번역 없이 벽시계 그대로 전달 — 실서버도 epoch ms 그대로 보낸다.
  private collectShields(): ShieldInfo[] {
    const now = Date.now();
    const out: ShieldInfo[] = [];
    for (let holderId = 0; holderId < this.gs.shieldUntil.length; holderId++) {
      const until = this.gs.shieldUntil[holderId];
      if (until > now) out.push({ holderId, until });
    }
    return out;
  }

  private collectMissiles(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.gs.n; i++) if (this.gs.missiles[i]) out.push(i);
    return out;
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
  onConnectionChange(cb: (connected: boolean) => void): void {
    this.connectionCb = cb;
  }

  // 개발용: 끊김/재연결 UI를 목 모드에서 테스트하기 위한 수동 트리거(프로덕션 경로 아님).
  simulateConnection(connected: boolean): void {
    this.connectionCb?.(connected);
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
