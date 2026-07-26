import { CONFIG, MY_HOLDER_ID, NEUTRAL_HOLDER_ID } from "../config";
import type { DongStaticMeta, Holder, LogEntry, Order, Rank } from "./types";

// ── 헥사고날 도메인 코어 ──────────────────────────────────────────────
// 순수 게임 규칙만 둔다. React·MapLibre·Zustand·브라우저 시계에 의존하지 않는다.
// 모든 상태는 GameState 인자로 받고, 시간이 필요하면 호출자가 밀리초로 주입한다.
// 덕분에 동일한 규칙 코드를 클라이언트(예측)와 서버(권위)가 각자의 GameState로
// 공유 실행할 수 있다. (PvP → 서버 권위 확장 이음매. README §9~§10)

export interface GameState {
  n: number;
  // README §3.1 — 동 상태(가변)
  ownerId: Uint8Array;
  troops: Uint16Array;
  troopAccum: Float32Array; // 정수 troops에 소수 생산량을 이월시키기 위한 내부 누산기
  // README §3.3 — 정적 메타 (게임 중 불변)
  troopCap: Uint16Array;
  neighborIndex: number[][];
  meta: DongStaticMeta[];
  // README §3.2 — holderId 간접 계층
  holders: Map<number, Holder>;
  dirty: Set<number>; // feature-state 리페인트 대상 admIndex
  orders: Order[]; // 이동 중인 유닛(원) 목록
  logEntries: LogEntry[];
  nextLogId: number;
}

export type SortieResult = { ok: true } | { ok: false; reason: string };

export interface LeaderboardRow {
  holderId: number;
  name: string;
  count: number;
}

// 새 게임 상태를 만든다. wallNowMs = 시작 로그 타임스탬프(호출자가 주입).
// n=0 이면 빈 상태(클라이언트 초기 자리표시자)로 만든다.
export function createGameState(
  n: number,
  neighborIndex: number[][],
  meta: DongStaticMeta[],
  startIndex: number,
  wallNowMs: number
): GameState {
  const ownerId = new Uint8Array(n);
  const troops = new Uint16Array(n).fill(CONFIG.NEUTRAL_TROOPS);
  const troopAccum = new Float32Array(n);
  // pop 데이터 미보유 → README §3.4 fallback: 전 동 균일 상한
  const troopCap = new Uint16Array(n).fill(CONFIG.BASE_CAP);

  const holders = new Map<number, Holder>();
  holders.set(NEUTRAL_HOLDER_ID, { id: NEUTRAL_HOLDER_ID, name: "중립", paletteIdx: 0 });
  holders.set(MY_HOLDER_ID, { id: MY_HOLDER_ID, name: "나", paletteIdx: 1 });

  const s: GameState = {
    n,
    ownerId,
    troops,
    troopAccum,
    troopCap,
    neighborIndex,
    meta,
    holders,
    dirty: new Set<number>(),
    orders: [],
    logEntries: [],
    nextLogId: 1,
  };

  if (n > 0) {
    ownerId[startIndex] = MY_HOLDER_ID;
    troops[startIndex] = troopCap[startIndex];
    pushLog(s, `${meta[startIndex].name}에서 시작합니다.`, wallNowMs);
  }
  return s;
}

// 시작 동 선택: 전체 라벨 지점의 무게중심에 가장 가까운 동 (하드코딩 없이 데이터 기반).
export function pickStartIndex(meta: DongStaticMeta[]): number {
  let sx = 0;
  let sy = 0;
  for (const m of meta) {
    sx += m.centroid[0];
    sy += m.centroid[1];
  }
  const cx = sx / meta.length;
  const cy = sy / meta.length;

  let best = 0;
  let bestDist = Infinity;
  meta.forEach((m, i) => {
    const dx = m.centroid[0] - cx;
    const dy = m.centroid[1] - cy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

// README §4.1 — 접속 중인(=목업에서는 나의) 동만 상한까지 생산.
export function tickProduction(s: GameState, dtSec: number) {
  for (let i = 0; i < s.n; i++) {
    if (s.ownerId[i] === NEUTRAL_HOLDER_ID) continue;
    if (s.troops[i] >= s.troopCap[i]) continue;

    s.troopAccum[i] += (dtSec * s.troopCap[i]) / CONFIG.FILL_TO_CAP_SEC;
    const inc = Math.floor(s.troopAccum[i]);
    if (inc <= 0) continue;

    s.troopAccum[i] -= inc;
    const next = Math.min(s.troopCap[i], s.troops[i] + inc);
    if (next !== s.troops[i]) {
      s.troops[i] = next;
      s.dirty.add(i);
    }
  }
}

// README §4.2, §4.4 — 출정. 병력을 출발지에서 즉시 빼고 이동 유닛(order)을 띄운다.
// 실제 전투/증원은 유닛이 목적지에 도착할 때(tickOrders) 처리한다.
// nowMs = 단조(monotonic) 시각. 유닛의 depart/arrive 틱 계산에만 쓴다.
export function trySortie(
  s: GameState,
  from: number,
  to: number,
  holderId: number,
  nowMs: number,
  ratio: number = CONFIG.SORTIE_RATIO // 출정 비율. 플레이어는 UI 슬라이더 값, E AI 등은 기본값.
): SortieResult {
  if (s.ownerId[from] !== holderId) return { ok: false, reason: "본인 소유 동이 아닙니다." };
  if (!s.neighborIndex[from]?.includes(to)) return { ok: false, reason: "인접한 동이 아닙니다." };

  let amount = Math.floor(s.troops[from] * ratio);
  if (amount <= 0) return { ok: false, reason: "출정 가능한 병력이 없습니다." };

  // 목적지가 내 동(증원)이면 상한 여유분만큼만 보낸다 — 초과분 소멸 방지. 여유가 없으면 거부.
  if (s.ownerId[to] === holderId) {
    const headroom = s.troopCap[to] - s.troops[to];
    if (headroom <= 0) return { ok: false, reason: "이미 병력이 가득 찬 동입니다." };
    if (amount > headroom) amount = headroom;
  }

  s.troops[from] -= amount; // 병력은 출발과 동시에 출발지를 떠난다.
  s.dirty.add(from);

  const travelSec = clamp(
    centroidDistance(s, from, to) / CONFIG.UNIT_SPEED_DEG_PER_SEC,
    CONFIG.UNIT_TRAVEL_MIN_SEC,
    CONFIG.UNIT_TRAVEL_MAX_SEC
  );
  s.orders.push({
    from,
    to,
    amount,
    holderId,
    departTick: nowMs,
    arriveTick: nowMs + travelSec * 1000,
  });
  return { ok: true };
}

// 매 프레임 호출 — 도착한 유닛의 전투/증원을 처리하고 목록에서 제거.
// nowMs = 단조 시각(도착 판정), wallNowMs = 벽시계(함락 로그 타임스탬프).
export function tickOrders(s: GameState, nowMs: number, wallNowMs: number) {
  for (let i = s.orders.length - 1; i >= 0; i--) {
    if (nowMs >= s.orders[i].arriveTick) {
      resolveArrival(s, s.orders[i], wallNowMs);
      s.orders.splice(i, 1);
    }
  }
}

// README §4.3 — 전투 판정 (유닛 도착 시). 출발지 차감은 trySortie에서 이미 끝났다.
function resolveArrival(s: GameState, order: Order, wallNowMs: number) {
  const { to, amount, holderId } = order;

  if (s.ownerId[to] === holderId) {
    s.troops[to] = Math.min(s.troopCap[to], s.troops[to] + amount);
  } else {
    const remaining = s.troops[to] - amount; // 부호 있는 일반 number 연산으로 먼저 계산
    if (remaining < 0) {
      const prevOwner = s.ownerId[to];
      const prevHolder = s.holders.get(prevOwner);
      const nextHolder = s.holders.get(holderId);
      s.ownerId[to] = holderId;
      s.troops[to] = -remaining;
      // README §4.6 토벌 보상 — 플레이어가 E 동을 함락하면 보너스 병력.
      const playerBeatEnv =
        prevOwner === CONFIG.ENV_HOLDER_ID &&
        holderId !== CONFIG.ENV_HOLDER_ID &&
        holderId !== NEUTRAL_HOLDER_ID;
      if (playerBeatEnv) s.troops[to] += CONFIG.ENV_BOUNTY;
      pushLog(
        s,
        `${s.meta[to].name} 함락 — ${prevHolder?.name ?? "?"} → ${nextHolder?.name ?? "?"}` +
          (playerBeatEnv ? ` (+${CONFIG.ENV_BOUNTY} 토벌)` : ""),
        wallNowMs
      );
    } else {
      s.troops[to] = remaining;
    }
  }
  s.dirty.add(to);
}

function centroidDistance(s: GameState, from: number, to: number): number {
  const a = s.meta[from].centroid;
  const b = s.meta[to].centroid;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function drainDirty(s: GameState): number[] {
  if (s.dirty.size === 0) return [];
  const list = Array.from(s.dirty);
  s.dirty.clear();
  return list;
}

// ts = 로그 타임스탬프(호출자 주입). 현재 UI에서 표시하진 않으나 타임랩스 확장용으로 보존.
export function pushLog(s: GameState, message: string, ts: number) {
  s.logEntries = [{ id: s.nextLogId++, ts, message }, ...s.logEntries].slice(0, 30);
}

export function ownedCount(s: GameState, holderId: number): number {
  let c = 0;
  for (let i = 0; i < s.n; i++) if (s.ownerId[i] === holderId) c++;
  return c;
}

// README §4.6, §8 — 순위표는 중립·환경 세력(E)을 제외한 플레이어만.
export function getLeaderboard(s: GameState): LeaderboardRow[] {
  return Array.from(s.holders.values())
    .filter((h) => h.id !== NEUTRAL_HOLDER_ID && h.id !== CONFIG.ENV_HOLDER_ID)
    .map((h) => ({ holderId: h.id, name: h.name, count: ownedCount(s, h.id) }))
    .sort((a, b) => b.count - a.count);
}

// README §6 — 계급은 저장하지 않고 소유권에서 매번 파생.
export function computeRank(s: GameState, holderId: number): Rank {
  if (holderId === NEUTRAL_HOLDER_ID || s.n === 0) return null;

  const sggTotal = new Map<string, number>();
  const sggOwned = new Map<string, number>();
  let anyOwned = false;

  for (let i = 0; i < s.n; i++) {
    const sgg = s.meta[i].sggcd;
    sggTotal.set(sgg, (sggTotal.get(sgg) ?? 0) + 1);
    if (s.ownerId[i] === holderId) {
      anyOwned = true;
      sggOwned.set(sgg, (sggOwned.get(sgg) ?? 0) + 1);
    }
  }
  if (!anyOwned) return null;

  let fullSgg = 0;
  for (const [sgg, total] of sggTotal) {
    if ((sggOwned.get(sgg) ?? 0) === total) fullSgg++;
  }
  if (fullSgg === 0) return "동장";
  if (fullSgg === sggTotal.size) return "도지사"; // 목업은 서울 단일 시도라 실질 도달은 어려움
  return "시장";
}

// ── 환경 세력 (E) — README §4.6 ──────────────────────────────────────
// 문명 야만인형 초반 조연. 상한(하드캡·never-surpass)이 있어 맵을 장악하지 못한다.

export function envCellCount(s: GameState): number {
  return ownedCount(s, CONFIG.ENV_HOLDER_ID);
}

function maxPlayerCells(s: GameState): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < s.n; i++) {
    const o = s.ownerId[i];
    if (o !== NEUTRAL_HOLDER_ID && o !== CONFIG.ENV_HOLDER_ID) {
      counts.set(o, (counts.get(o) ?? 0) + 1);
    }
  }
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  return max;
}

// E holder 등록 + 시작 동 배정. cells는 호출자(외곽 선정 등)가 정해 넘긴다.
export function envSpawn(s: GameState, cells: number[], paletteIdx: number, wallNowMs: number) {
  s.holders.set(CONFIG.ENV_HOLDER_ID, {
    id: CONFIG.ENV_HOLDER_ID,
    name: "야만인",
    paletteIdx,
  });
  for (const i of cells) {
    if (s.ownerId[i] !== NEUTRAL_HOLDER_ID) continue; // 이미 점령된 동은 건너뜀
    s.ownerId[i] = CONFIG.ENV_HOLDER_ID;
    s.troops[i] = s.troopCap[i];
    s.dirty.add(i);
  }
  if (cells.length > 0) pushLog(s, "야만인이 나타났습니다.", wallNowMs);
}

// E 행동 1회 — 호출자가 ENV_ACT_INTERVAL_SEC 주기로 부른다.
// 상한에 여유가 있을 때만 "최다 병력 동 → 인접 최소 병력 동"으로 출정(trySortie 재사용).
// 새로 발주된 order가 있으면 반환(호출자가 DELTA에 실어 보낸다).
export function tickEnv(s: GameState, nowMs: number): Order | null {
  const env = envCellCount(s);
  if (env === 0) return null; // 소멸됨(전부 함락) — 재스폰 없음

  const hardCap = Math.round(CONFIG.ENV_MAX_RATIO * s.n);
  const softCap = Math.max(CONFIG.ENV_MIN_PRESENCE, maxPlayerCells(s));
  if (env >= Math.min(hardCap, softCap)) return null; // 상한 도달 → 확장 안 함

  // 최다 병력 E 동 X
  let X = -1;
  let bestT = -1;
  for (let i = 0; i < s.n; i++) {
    if (s.ownerId[i] === CONFIG.ENV_HOLDER_ID && s.troops[i] > bestT) {
      bestT = s.troops[i];
      X = i;
    }
  }
  if (X < 0) return null;

  // X 인접 중 병력 최소인 비-E 동 Y
  let Y = -1;
  let minT = Infinity;
  for (const j of s.neighborIndex[X]) {
    if (s.ownerId[j] !== CONFIG.ENV_HOLDER_ID && s.troops[j] < minT) {
      minT = s.troops[j];
      Y = j;
    }
  }
  if (Y < 0) return null;

  // 이길 만할 때만(자살 공격 방지)
  const amount = Math.floor(s.troops[X] * CONFIG.SORTIE_RATIO);
  if (amount <= s.troops[Y] * CONFIG.ENV_ATTACK_MARGIN) return null;

  const before = s.orders.length;
  const res = trySortie(s, X, Y, CONFIG.ENV_HOLDER_ID, nowMs);
  if (res.ok && s.orders.length > before) return s.orders[s.orders.length - 1];
  return null;
}
