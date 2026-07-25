import { CONFIG, MY_HOLDER_ID, NEUTRAL_HOLDER_ID } from "../config";
import type { DongStaticMeta, Holder, LogEntry, Order, Rank } from "./types";

// README.md §3.1, §3.2 — 동 상태(가변) + holderId 간접 계층. React 밖에 둔다.
export let N = 0;
export let ownerId = new Uint8Array(0);
export let troops = new Uint16Array(0);
let troopAccum = new Float32Array(0); // 정수 troops에 소수 생산량을 이월시키기 위한 내부 누산기

// README.md §3.3 — 정적 메타 (게임 중 불변)
export let troopCap = new Uint16Array(0);
export let neighborIndex: number[][] = [];
export let meta: DongStaticMeta[] = [];

export const holders = new Map<number, Holder>();
export const dirty = new Set<number>(); // feature-state 리페인트 대상 admIndex
export let logEntries: LogEntry[] = [];
let nextLogId = 1;

// 이동 중인 유닛(원) 목록. 렌더러가 매 프레임 읽어 위치를 보간해 그린다.
export const orders: Order[] = [];

export function initGame(
  n: number,
  neighborIdx: number[][],
  staticMeta: DongStaticMeta[],
  startIndex: number
) {
  N = n;
  ownerId = new Uint8Array(n);
  troops = new Uint16Array(n).fill(CONFIG.NEUTRAL_TROOPS);
  troopAccum = new Float32Array(n);
  // pop 데이터 미보유 → README.md §3.4 fallback: 전 동 균일 상한
  troopCap = new Uint16Array(n).fill(CONFIG.BASE_CAP);
  neighborIndex = neighborIdx;
  meta = staticMeta;

  holders.clear();
  holders.set(NEUTRAL_HOLDER_ID, { id: NEUTRAL_HOLDER_ID, name: "중립", paletteIdx: 0 });
  holders.set(MY_HOLDER_ID, { id: MY_HOLDER_ID, name: "나", paletteIdx: 1 });

  ownerId[startIndex] = MY_HOLDER_ID;
  troops[startIndex] = troopCap[startIndex];

  dirty.clear();
  orders.length = 0;
  logEntries = [];
  nextLogId = 1;
  pushLog(`${meta[startIndex].name}에서 시작합니다.`);
}

// 시작 동 선택: 전체 라벨 지점의 무게중심에 가장 가까운 동 (하드코딩 없이 데이터 기반).
export function pickStartIndex(staticMeta: DongStaticMeta[]): number {
  let sx = 0;
  let sy = 0;
  for (const m of staticMeta) {
    sx += m.centroid[0];
    sy += m.centroid[1];
  }
  const cx = sx / staticMeta.length;
  const cy = sy / staticMeta.length;

  let best = 0;
  let bestDist = Infinity;
  staticMeta.forEach((m, i) => {
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

// README.md §4.1 — 접속 중인(=목업에서는 나의) 동만 상한까지 생산.
export function tickProduction(dtSec: number) {
  for (let i = 0; i < N; i++) {
    if (ownerId[i] === NEUTRAL_HOLDER_ID) continue;
    if (troops[i] >= troopCap[i]) continue;

    troopAccum[i] += (dtSec * troopCap[i]) / CONFIG.FILL_TO_CAP_SEC;
    const inc = Math.floor(troopAccum[i]);
    if (inc <= 0) continue;

    troopAccum[i] -= inc;
    const next = Math.min(troopCap[i], troops[i] + inc);
    if (next !== troops[i]) {
      troops[i] = next;
      dirty.add(i);
    }
  }
}

export type SortieResult = { ok: true } | { ok: false; reason: string };

// README.md §4.2, §4.4 — 출정. 병력을 출발지에서 즉시 빼고 이동 유닛(order)을 띄운다.
// 실제 전투/증원은 유닛이 목적지에 도착할 때(tickOrders) 처리한다.
export function trySortie(from: number, to: number, holderId: number): SortieResult {
  if (ownerId[from] !== holderId) return { ok: false, reason: "본인 소유 동이 아닙니다." };
  if (!neighborIndex[from]?.includes(to)) return { ok: false, reason: "인접한 동이 아닙니다." };

  const amount = Math.floor(troops[from] * CONFIG.SORTIE_RATIO);
  if (amount <= 0) return { ok: false, reason: "출정 가능한 병력이 없습니다." };

  troops[from] -= amount; // 병력은 출발과 동시에 출발지를 떠난다.
  dirty.add(from);

  const now = performance.now();
  const travelSec = clamp(
    centroidDistance(from, to) / CONFIG.UNIT_SPEED_DEG_PER_SEC,
    CONFIG.UNIT_TRAVEL_MIN_SEC,
    CONFIG.UNIT_TRAVEL_MAX_SEC
  );
  orders.push({ from, to, amount, holderId, departTick: now, arriveTick: now + travelSec * 1000 });
  return { ok: true };
}

// 매 프레임 호출 — 도착한 유닛의 전투/증원을 처리하고 목록에서 제거.
export function tickOrders(now: number) {
  for (let i = orders.length - 1; i >= 0; i--) {
    if (now >= orders[i].arriveTick) {
      resolveArrival(orders[i]);
      orders.splice(i, 1);
    }
  }
}

// README.md §4.3 — 전투 판정 (유닛 도착 시). 출발지 차감은 trySortie에서 이미 끝났다.
function resolveArrival(order: Order) {
  const { to, amount, holderId } = order;

  if (ownerId[to] === holderId) {
    troops[to] = Math.min(troopCap[to], troops[to] + amount);
  } else {
    const remaining = troops[to] - amount; // 부호 있는 일반 number 연산으로 먼저 계산
    if (remaining < 0) {
      const prevHolder = holders.get(ownerId[to]);
      const nextHolder = holders.get(holderId);
      ownerId[to] = holderId;
      troops[to] = -remaining;
      pushLog(`${meta[to].name} 함락 — ${prevHolder?.name ?? "?"} → ${nextHolder?.name ?? "?"}`);
    } else {
      troops[to] = remaining;
    }
  }
  dirty.add(to);
}

function centroidDistance(from: number, to: number): number {
  const a = meta[from].centroid;
  const b = meta[to].centroid;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function drainDirty(): number[] {
  if (dirty.size === 0) return [];
  const list = Array.from(dirty);
  dirty.clear();
  return list;
}

export function pushLog(message: string) {
  logEntries = [{ id: nextLogId++, ts: Date.now(), message }, ...logEntries].slice(0, 30);
}

export function ownedCount(holderId: number): number {
  let c = 0;
  for (let i = 0; i < N; i++) if (ownerId[i] === holderId) c++;
  return c;
}

export interface LeaderboardRow {
  holderId: number;
  name: string;
  count: number;
}

export function getLeaderboard(): LeaderboardRow[] {
  return Array.from(holders.values())
    .filter((h) => h.id !== NEUTRAL_HOLDER_ID)
    .map((h) => ({ holderId: h.id, name: h.name, count: ownedCount(h.id) }))
    .sort((a, b) => b.count - a.count);
}

// README.md §6 — 계급은 저장하지 않고 소유권에서 매번 파생.
export function computeRank(holderId: number): Rank {
  if (holderId === NEUTRAL_HOLDER_ID || N === 0) return null;

  const sggTotal = new Map<string, number>();
  const sggOwned = new Map<string, number>();
  let anyOwned = false;

  for (let i = 0; i < N; i++) {
    const sgg = meta[i].sggcd;
    sggTotal.set(sgg, (sggTotal.get(sgg) ?? 0) + 1);
    if (ownerId[i] === holderId) {
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
