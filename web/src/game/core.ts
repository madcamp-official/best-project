import { CONFIG, MY_HOLDER_ID, NEUTRAL_HOLDER_ID, PLAYER_PALETTE_IDXS } from "../config";
import type { DongStaticMeta, Holder, LogEntry, Order, Rank, ShieldInfo } from "./types";

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
  // 이 게임(세션) 한정 색 슬롯 배정표 — PLAYER_PALETTE_IDXS를 생성 시 한 번 셔플한다.
  // holder는 (holderId-1) 위치의 슬롯을 받아 8명까지 안 겹치고 판마다 배정이 달라진다.
  // server World.playerPaletteBag 대응.
  playerPaletteBag: number[];
  dirty: Set<number>; // feature-state 리페인트 대상 admIndex
  orders: Order[]; // 이동 중인 유닛(원) 목록
  missiles: Uint8Array; // 동별 미사일 보유 여부(0/1). 동에 종속 — 그 동 소유자가 발사 가능.
  // 공격 큐: holderId → 공격 대상 admIndex 집합. 매 주기 각 대상에 인접한 내 동들이 자동 출정하고,
  // 후방 병력은 tickSupply가 가장 가까운 대상(전선)으로 자동 전진시킨다(예전 집결지(rally) 대체).
  // 크기 256(holderId별). 시뮬레이터(목/서버)만 채운다(클라 사본은 world.myAttackQueue로 내 것만 추적).
  attackQueue: Set<number>[];
  // 공수부대(B3): holderId → 재사용 가능해지는 단조 시각(ms). 0=쿨타임 없음. 크기 256.
  airdropReadyAt: Float64Array;
  // 스폰 방어막: holderId → 보호 종료 시각(ms, 호출자의 시간축 그대로 — 시뮬레이터는 wallNowMs).
  // 0=방어막 없음. 크기 256. applyShield가 설정, resolveArrival/launchMissile/tickAnnex/
  // resolveAirdrop이 참조한다.
  shieldUntil: Float64Array;
  // 포위 귀속(README §포위): 경계 동 마스크(0/1, 정적)와, 각 동이 현재 어느 플레이어에게
  // 언제부터 포위됐는지(-1=포위 안 됨). ANNEX_HOLD_SEC 유지 판정용.
  borderMask: Uint8Array;
  enclosedBy: Int32Array; // 이 동을 현재 포위 중인 holderId (-1 = 없음)
  enclosedSince: Float64Array; // 연속 포위가 시작된 단조 시각(ms). enclosedBy=-1이면 무의미.
  // 전술핵 사일로 — NUKE_SILO_CODES 순서와 정렬된 admIndex(-1=데이터에 없음, 시도 축소 로드 등).
  // 사일로 동을 소유한 플레이어가 NUKE_COOLDOWN_SEC마다 일반 미사일의 NUKE_RADIUS_MULT배
  // 반경 미사일을 쏠 수 있다. 정적 데이터에서 파생되므로 클라·서버가 각자 initNukeState로 계산.
  nukeSilos: number[];
  nukeReadyAt: Float64Array; // 사일로별 재발사 가능 시각(호출자 시간축). 0=즉시 가능.
  // 사일로가 있는 섬(제주 = 본토와 인접이 끊긴 컴포넌트) 소속 동 마스크(0/1).
  // 이 섬을 오가는 공수는 사거리 제한을 받지 않는다.
  nukeIslandMask: Uint8Array;
  logEntries: LogEntry[];
  nextLogId: number;
  nextOrderId: number; // 이동 유닛(order) 고유 id 발급 카운터.
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
  wallNowMs: number,
  borderMask?: Uint8Array // 시뮬레이터(목/서버)만 주입. 클라 사본은 포위 판정을 안 돌리므로 생략.
): GameState {
  const ownerId = new Uint8Array(n);
  const troops = new Uint16Array(n).fill(CONFIG.NEUTRAL_TROOPS);
  const troopAccum = new Float32Array(n);
  // pop 데이터 미보유 → README §3.4 fallback: 전 동 균일 상한
  const troopCap = new Uint16Array(n).fill(CONFIG.BASE_CAP);

  // 이 게임 한정으로 색 슬롯을 셔플 → 나·AI 모두 여기서 (holderId-1) 위치의 슬롯을 받는다.
  const playerPaletteBag = [...PLAYER_PALETTE_IDXS];
  shuffleInPlace(playerPaletteBag);

  const holders = new Map<number, Holder>();
  holders.set(NEUTRAL_HOLDER_ID, { id: NEUTRAL_HOLDER_ID, name: "중립", paletteIdx: 0 });
  holders.set(MY_HOLDER_ID, {
    id: MY_HOLDER_ID,
    name: "나",
    paletteIdx: playerPaletteBag[(MY_HOLDER_ID - 1) % playerPaletteBag.length],
  });

  const s: GameState = {
    n,
    ownerId,
    troops,
    troopAccum,
    troopCap,
    neighborIndex,
    meta,
    holders,
    playerPaletteBag,
    dirty: new Set<number>(),
    orders: [],
    missiles: new Uint8Array(n),
    attackQueue: Array.from({ length: 256 }, () => new Set<number>()),
    airdropReadyAt: new Float64Array(256),
    shieldUntil: new Float64Array(256),
    borderMask: borderMask ?? new Uint8Array(n),
    enclosedBy: new Int32Array(n).fill(-1),
    enclosedSince: new Float64Array(n),
    nukeSilos: [],
    nukeReadyAt: new Float64Array(CONFIG.NUKE_SILO_CODES.length),
    nukeIslandMask: new Uint8Array(n),
    logEntries: [],
    nextLogId: 1,
    nextOrderId: 1,
  };
  initNukeState(s);

  if (n > 0) {
    ownerId[startIndex] = MY_HOLDER_ID;
    troops[startIndex] = troopCap[startIndex];
    applyShield(s, MY_HOLDER_ID, wallNowMs); // 시작 스폰 방어막(SPAWN_SHIELD_SEC)
    pushLog(s, `${meta[startIndex].name}에서 시작합니다.`, wallNowMs);
  }
  return s;
}

// 전술핵 사일로 상태 초기화 — 정적 데이터(meta·neighborIndex)에서 파생되므로 언제든 재계산
// 가능하다. 클라 world는 WELCOME으로 meta를 받은 뒤 이 함수를 다시 불러 채운다(재사용 이음매).
export function initNukeState(s: GameState) {
  s.nukeSilos = CONFIG.NUKE_SILO_CODES.map((code) => s.meta.findIndex((m) => m.code === code));
  s.nukeIslandMask = new Uint8Array(s.n);
  // 사일로 동에서 인접 그래프를 flood — 그 연결요소 전체가 "사일로 섬"(제주).
  for (const silo of s.nukeSilos) {
    if (silo < 0 || s.nukeIslandMask[silo]) continue;
    const stack = [silo];
    s.nukeIslandMask[silo] = 1;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      for (const nb of s.neighborIndex[cur] ?? []) {
        if (!s.nukeIslandMask[nb]) {
          s.nukeIslandMask[nb] = 1;
          stack.push(nb);
        }
      }
    }
  }
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
    const owner = s.ownerId[i];
    if (owner === NEUTRAL_HOLDER_ID) continue;
    if (s.troops[i] >= s.troopCap[i]) continue;

    // AI 플레이어는 생산량이 사람의 AI_PROD_MULT배(80%). 사람은 1배.
    const mult = s.holders.get(owner)?.isAi ? CONFIG.AI_PROD_MULT : 1;
    s.troopAccum[i] += (dtSec * s.troopCap[i] * mult) / CONFIG.FILL_TO_CAP_SEC;
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

  s.orders.push(makeOrder(s, from, to, amount, holderId, nowMs));
  return { ok: true };
}

// 드래그 쓸기 — 한 출발지(from)에서 여러 인접 목표(targets)로 병력을 균등 분할해 한 번에 출정한다.
// 출정 병력(troops*ratio)을 유효 목표 수로 나눠 목표마다 같은 몫을 보낸다(증원 목표는 상한 여유로 제한).
// 클릭 한 번에 여러 인접 적·중립을 동시에 점령하기 위한 것 — 각 order는 여전히 단일 홉이다.
// 반환 = 새로 출발한 order 목록(호출자가 DELTA newOrders로 실어 보낸다).
export function tryMultiSortie(
  s: GameState,
  from: number,
  targets: number[],
  holderId: number,
  nowMs: number,
  ratio: number = CONFIG.SORTIE_RATIO
): { ok: true; orders: Order[] } | { ok: false; reason: string } {
  if (s.ownerId[from] !== holderId) return { ok: false, reason: "본인 소유 동이 아닙니다." };
  // 유효 목표 = from과 인접 + from 아님 + 중복 제거.
  const seen = new Set<number>();
  const valid: number[] = [];
  for (const t of targets) {
    if (t === from || t < 0 || t >= s.n || seen.has(t)) continue;
    if (!s.neighborIndex[from]?.includes(t)) continue;
    seen.add(t);
    valid.push(t);
  }
  if (valid.length === 0) return { ok: false, reason: "인접한 목표가 없습니다." };

  const total = Math.floor(s.troops[from] * ratio);
  if (total <= 0) return { ok: false, reason: "출정 가능한 병력이 없습니다." };
  const share = Math.floor(total / valid.length);
  if (share <= 0) return { ok: false, reason: "목표가 너무 많아 나눌 병력이 부족합니다." };

  const out: Order[] = [];
  for (const t of valid) {
    let amt = share;
    if (s.ownerId[t] === holderId) {
      // 증원 목표: 상한 여유분까지만(초과분 소멸 방지). 여유가 없으면 건너뛴다.
      const headroom = s.troopCap[t] - s.troops[t];
      if (headroom <= 0) continue;
      if (amt > headroom) amt = headroom;
    }
    if (amt <= 0) continue;
    s.troops[from] -= amt; // 몫만큼 즉시 출발지에서 차감(총합 ≤ total ≤ 보유량이라 음수 안 됨)
    const order = makeOrder(s, from, t, amt, holderId, nowMs);
    s.orders.push(order);
    out.push(order);
  }
  if (out.length === 0) return { ok: false, reason: "보낼 병력이 없습니다." };
  s.dirty.add(from);
  return { ok: true, orders: out };
}

// 이동 유닛(order) 하나를 만든다. path가 있으면 경로 자동 출정(B1)의 릴레이 컬럼이 된다.
function makeOrder(
  s: GameState,
  from: number,
  to: number,
  amount: number,
  holderId: number,
  nowMs: number,
  path?: number[],
  speedDegPerSec: number = CONFIG.UNIT_SPEED_DEG_PER_SEC,
  maxSec: number = CONFIG.UNIT_TRAVEL_MAX_SEC
): Order {
  const travelSec = clamp(
    centroidDistance(s, from, to) / speedDegPerSec,
    CONFIG.UNIT_TRAVEL_MIN_SEC,
    maxSec
  );
  return {
    id: s.nextOrderId++,
    from,
    to,
    amount,
    holderId,
    departTick: nowMs,
    arriveTick: nowMs + travelSec * 1000,
    ...(path && path.length > 0 ? { path } : {}),
  };
}

// ① 미사일이 이동 유닛도 타격 — 착탄 동(cells) 위를 지나던 이동 중 유닛(order)을 전부 파괴한다.
// from 또는 to가 타격 동이면 그 유닛은 타격 영토를 밟고 있는 것으로 보고 소멸시킨다.
// 반환 = 파괴된 order id 목록(호출자가 DELTA removedOrders로 실어 클라 렌더에서 제거).
// launchMissile/launchNuke는 동(territory)만 중립화하므로, 유닛 타격은 이 헬퍼를 따로 호출한다.
// server .../domain/GameCore.kt destroyOrdersOnCells 1:1 대응.
export function destroyOrdersOnCells(s: GameState, cells: number[]): number[] {
  if (cells.length === 0 || s.orders.length === 0) return [];
  const hit = new Set(cells);
  const removed: number[] = [];
  const survivors: Order[] = [];
  for (const o of s.orders) {
    if (hit.has(o.from) || hit.has(o.to)) removed.push(o.id);
    else survivors.push(o);
  }
  if (removed.length > 0) s.orders = survivors;
  return removed;
}

// ② 같은 통로 정면충돌 — A→B와 B→A(같은 변, 반대 방향, 다른 소유주)가 서로를 지나친 순간
// 중간에서 클래시한다: 작은 쪽 소멸, 큰 쪽은 차액으로 계속(같으면 둘 다 소멸). 호출자가 매 tick 호출.
// 반환 = 제거된 id + 병력이 바뀐 유닛{ id, amount } (DELTA removedOrders/updatedOrders로 반영).
export function tickOrderClashes(
  s: GameState,
  nowMs: number
): { removed: number[]; updated: { id: number; amount: number }[] } {
  const removed: number[] = [];
  const updated: { id: number; amount: number }[] = [];
  // 방향별 변 인덱스: `from_to` → 그 방향으로 이동 중인 order들.
  const byEdge = new Map<string, Order[]>();
  for (const o of s.orders) {
    if (nowMs >= o.arriveTick) continue; // 곧 도착(tickOrders가 처리) — 충돌 대상 아님
    const k = o.from + "_" + o.to;
    const arr = byEdge.get(k);
    if (arr) arr.push(o);
    else byEdge.set(k, [o]);
  }
  const progress = (o: Order) => {
    const span = o.arriveTick - o.departTick;
    return span > 0 ? Math.min(1, Math.max(0, (nowMs - o.departTick) / span)) : 1;
  };
  const consumed = new Set<number>();
  for (const o1 of s.orders) {
    if (consumed.has(o1.id) || nowMs >= o1.arriveTick) continue;
    const opp = byEdge.get(o1.to + "_" + o1.from); // 반대 방향(같은 변)
    if (!opp) continue;
    for (const o2 of opp) {
      if (consumed.has(o1.id)) break;
      if (consumed.has(o2.id) || o2.holderId === o1.holderId) continue; // 아군끼리는 통과
      if (progress(o1) + progress(o2) < 1) continue; // 아직 서로를 안 지나침
      if (o1.amount > o2.amount) {
        o1.amount -= o2.amount;
        updated.push({ id: o1.id, amount: o1.amount });
        consumed.add(o2.id);
        removed.push(o2.id);
      } else if (o2.amount > o1.amount) {
        o2.amount -= o1.amount;
        updated.push({ id: o2.id, amount: o2.amount });
        consumed.add(o1.id);
        removed.push(o1.id);
      } else {
        consumed.add(o1.id);
        consumed.add(o2.id);
        removed.push(o1.id, o2.id);
      }
    }
  }
  if (consumed.size > 0) s.orders = s.orders.filter((o) => !consumed.has(o.id));
  return { removed, updated };
}

// README §B1 — 경로 자동 출정. 멀리 있는 내 동(finalTarget)까지 내 영토만 밟는 최단 경로를
// 찾아, 출발지에서 병력을 빼고 그 경로를 통째로 지고 가는 릴레이 컬럼 1개를 띄운다.
// 인접 제약(단일 홉)은 유지한 채 UI만 원거리 지정을 허용하는 것 — 내부 order는 여전히 홉 단위다.
export function tryMarch(
  s: GameState,
  from: number,
  finalTarget: number,
  holderId: number,
  nowMs: number,
  ratio: number = CONFIG.SORTIE_RATIO
): SortieResult {
  if (s.ownerId[from] !== holderId) return { ok: false, reason: "본인 소유 동이 아닙니다." };
  if (from === finalTarget) return { ok: false, reason: "같은 동입니다." };
  if (s.ownerId[finalTarget] !== holderId)
    return { ok: false, reason: "내 소유 동으로만 자동 행군할 수 있습니다." };

  const nodes = ownedPath(s, from, finalTarget, holderId, CONFIG.MARCH_MAX_HOPS);
  if (!nodes || nodes.length < 2) return { ok: false, reason: "연결된 내 영토 경로가 없습니다." };

  const amount = Math.floor(s.troops[from] * ratio);
  if (amount <= 0) return { ok: false, reason: "출정 가능한 병력이 없습니다." };

  s.troops[from] -= amount;
  s.dirty.add(from);

  // nodes = [from, h1, h2, ..., finalTarget]. 첫 leg = from→h1, 남은 경로 = [h2..finalTarget].
  s.orders.push(makeOrder(s, from, nodes[1], amount, holderId, nowMs, nodes.slice(2)));
  return { ok: true };
}

// from→to를 잇는 최단 경로를 BFS로 찾되, 통과 가능한 동은 holderId 소유 동만이다(내 영토 릴레이).
// 반환 = [from, ..., to] 노드열, 도달 불가면 null. maxHops를 넘는 깊이는 탐색하지 않는다.
function ownedPath(
  s: GameState,
  from: number,
  to: number,
  holderId: number,
  maxHops: number
): number[] | null {
  const prev = new Int32Array(s.n).fill(-2); // -2=미방문, -1=출발지
  const dist = new Int32Array(s.n);
  prev[from] = -1;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    if (cur === to) break;
    if (dist[cur] >= maxHops) continue;
    for (const nb of s.neighborIndex[cur]) {
      if (prev[nb] !== -2 || s.ownerId[nb] !== holderId) continue; // 내 소유 동만 밟는다
      prev[nb] = cur;
      dist[nb] = dist[cur] + 1;
      q.push(nb);
    }
  }
  if (prev[to] === -2) return null; // 도달 불가(내 영토로 이어지지 않음)
  const rev: number[] = [];
  for (let c = to; c !== -1; c = prev[c]) rev.push(c);
  return rev.reverse();
}

// 매 프레임 호출 — 도착한 유닛의 전투/증원을 처리하고 목록에서 제거.
// nowMs = 단조 시각(도착 판정), wallNowMs = 벽시계(함락 로그 타임스탬프).
// 경로 자동 출정(B1)의 릴레이가 이어지는 경우, 이번 tick에 새로 발주된 다음-홉 order들을 반환한다
// (호출자가 DELTA newOrders에 실어 보낸다).
export function tickOrders(s: GameState, nowMs: number, wallNowMs: number): Order[] {
  const newLegs: Order[] = [];
  for (let i = s.orders.length - 1; i >= 0; i--) {
    if (nowMs >= s.orders[i].arriveTick) {
      const leg = resolveArrival(s, s.orders[i], nowMs, wallNowMs);
      s.orders.splice(i, 1);
      if (leg) newLegs.push(leg);
    }
  }
  // 다음-홉 order는 루프가 끝난 뒤 추가한다(arriveTick이 미래라 이번 tick엔 재도착 판정되지 않는다).
  for (const leg of newLegs) s.orders.push(leg);
  return newLegs;
}

// README §4.3 — 전투 판정 (유닛 도착 시). 출발지 차감은 trySortie에서 이미 끝났다.
// 릴레이 컬럼(경로 자동 출정)이면 다음-홉 order를 반환, 아니면 null.
function resolveArrival(s: GameState, order: Order, nowMs: number, wallNowMs: number): Order | null {
  const { from, to, amount, holderId, path } = order;

  // 공수부대(B3): 도착 시 목적지에 투하하고 상한 초과분을 인접 flood로 점령/증원한다(릴레이 아님).
  if (order.airdrop) {
    resolveAirdrop(s, to, amount, holderId, wallNowMs);
    return null;
  }

  // 경로 자동 출정: 남은 경로가 있고 이 동과 다음 홉이 모두 내 소유면 '통과'만 하고 다음 홉으로 이어간다.
  // (경로가 끊겼으면 — to를 잃었거나 다음 홉을 잃었으면 — 아래 일반 로직으로 여기서 정착한다.)
  if (path && path.length > 0 && s.ownerId[to] === holderId && s.ownerId[path[0]] === holderId) {
    return makeOrder(s, to, path[0], amount, holderId, nowMs, path.slice(1));
  }

  if (s.ownerId[to] === holderId) {
    // 증원: 상한까지만 채우고, 넘치는 병력은 출발지로 되돌린다.
    // (같은 동에 여러 출정이 동시에 도착할 때 상한 초과분이 소멸하던 버그 방지 —
    //  출발지는 이 병력을 이미 내보냈으므로 되돌려도 대개 상한 안에 들어간다.)
    const space = Math.max(0, s.troopCap[to] - s.troops[to]);
    const accepted = Math.min(amount, space);
    s.troops[to] += accepted;
    const overflow = amount - accepted;
    if (overflow > 0 && s.ownerId[from] === holderId) {
      s.troops[from] = Math.min(s.troopCap[from], s.troops[from] + overflow);
      s.dirty.add(from);
    }
  } else {
    // 스폰 방어막은 미사일·전술핵만 막는다 — 유닛 도착 전투는 방어막과 무관하게 정상 진행.
    const prevOwner = s.ownerId[to];
    const remaining = s.troops[to] - amount; // 부호 있는 일반 number 연산으로 먼저 계산
    if (remaining < 0) {
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
  return null;
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

// ── 미사일 ────────────────────────────────────────────────────────────
// 동에 종속: 미사일은 특정 동 위에 얹혀 있고, 그 동을 소유한 홀더가 발사할 수 있다.
// 개인 보유 수 = 내가 소유한 동 중 미사일이 얹힌 동 수.

export function missileCount(s: GameState, holderId: number): number {
  let c = 0;
  for (let i = 0; i < s.n; i++) if (s.ownerId[i] === holderId && s.missiles[i]) c++;
  return c;
}

// 맵 전체에 존재하는 미사일 총 수(소유·중립 무관).
export function totalMissileCount(s: GameState): number {
  let c = 0;
  for (let i = 0; i < s.n; i++) if (s.missiles[i]) c++;
  return c;
}

// 무작위 동 1곳에 미사일 스폰. 맵 전체 총량이 상한이면 스폰하지 않고, 이미 미사일이 있는
// 동은 건너뛴다(개인 보유 한도 없음 — 맵 총량만으로 제한). 반환 = 스폰된 admIndex, 없으면 -1.
export function trySpawnMissile(s: GameState): number {
  if (s.n === 0) return -1;
  if (totalMissileCount(s) >= CONFIG.MISSILE_MAX_TOTAL) return -1; // 맵 전체 상한

  // 시도를 먼저 균등 추첨한 뒤 그 안에서 동을 고른다 — 동 개수가 시도별로 크게 달라서
  // (서울·부산은 동이 촘촘히 쪼개져 있음) 동 단위로 그냥 균등 추첨하면 그쪽에 쏠린다.
  // 시도 단위로 먼저 공평하게 나눠야 전국에 고르게 퍼진다. (개인 보유 한도는 없음.)
  const bySido = new Map<string, number[]>();
  for (let i = 0; i < s.n; i++) {
    const sido = s.meta[i].sidocd;
    const list = bySido.get(sido);
    if (list) list.push(i);
    else bySido.set(sido, [i]);
  }
  const sidoGroups = Array.from(bySido.values());
  for (let t = sidoGroups.length - 1; t > 0; t--) {
    const j = Math.floor(Math.random() * (t + 1));
    [sidoGroups[t], sidoGroups[j]] = [sidoGroups[j], sidoGroups[t]];
  }

  for (const cells of sidoGroups) {
    if (cells.length === 0) continue;
    const start = Math.floor(Math.random() * cells.length);
    for (let k = 0; k < cells.length; k++) {
      const i = cells[(start + k) % cells.length];
      if (s.missiles[i]) continue;
      s.missiles[i] = 1;
      return i;
    }
  }
  return -1;
}

export type MissileResult =
  | { ok: true; removed: number; neutralized: number[] }
  | { ok: false; reason: string };

// 미사일 발사: 내 소유 동에 얹힌 미사일 1개를 소모하고, hits 동들을 중립화(병력 0)한다.
// hits는 호출자(전송 계층)가 반경/근접 검증까지 마친 목록이라고 가정한다.
export function launchMissile(
  s: GameState,
  holderId: number,
  hits: number[],
  wallNowMs: number
): MissileResult {
  let src = -1;
  for (let i = 0; i < s.n; i++) {
    if (s.ownerId[i] === holderId && s.missiles[i]) {
      src = i;
      break;
    }
  }
  if (src < 0) return { ok: false, reason: "발사할 미사일이 없습니다." };

  // 스폰 방어막이 보호 중인 영토가 목표에 포함되면 발사 자체를 거부한다(미사일 소모 없음).
  // 예전엔 발사는 되고 보호 동만 피해에서 빠졌는데, 그건 공격자가 미사일만 허비하는 함정이라
  // 발사 전에 막고 이유를 알려준다. (전술핵은 기존대로 착탄 시 보호 동만 무효화.)
  for (const h of hits) {
    if (h < 0 || h >= s.n) continue;
    if (isShielded(s, s.ownerId[h], wallNowMs)) {
      return { ok: false, reason: "스폰 방어막이 보호 중인 영토라 발사할 수 없습니다." };
    }
  }

  s.missiles[src] = 0; // 소모

  const neutralized: number[] = [];
  for (const h of hits) {
    if (h < 0 || h >= s.n) continue;
    s.ownerId[h] = NEUTRAL_HOLDER_ID;
    s.troops[h] = 0;
    s.troopAccum[h] = 0;
    s.dirty.add(h);
    neutralized.push(h);
  }
  pushLog(s, `미사일 착탄 — ${neutralized.length}개 동 중립화`, wallNowMs);
  return { ok: true, removed: src, neutralized };
}

// ── 전술핵 사일로 ─────────────────────────────────────────────────────
// 제주의 사일로 셀(NUKE_SILO_CODES)을 소유한 플레이어는 소모품 미사일 없이도
// NUKE_COOLDOWN_SEC마다 일반 미사일의 NUKE_RADIUS_MULT배 반경 미사일을 발사할 수 있다.

export type NukeResult =
  | { ok: true; silo: number; readyAtMs: number; neutralized: number[] }
  | { ok: false; reason: string };

// 내가 소유한 사일로 admIndex 목록(순서 = NUKE_SILO_CODES).
export function ownedNukeSilos(s: GameState, holderId: number): number[] {
  return s.nukeSilos.filter((idx) => idx >= 0 && s.ownerId[idx] === holderId);
}

// 전술핵 발사: 내가 소유하고 쿨다운이 끝난 사일로 1기를 쓴다(둘 다 보유 시 준비된 쪽 우선).
// hits는 호출자(전송 계층)가 전술핵 반경으로 검증한 목록. nowMs = 쿨다운 시간축(serverTime).
export function launchNuke(
  s: GameState,
  holderId: number,
  hits: number[],
  nowMs: number,
  wallNowMs: number
): NukeResult {
  let ownedK = -1; // 소유 중인 사일로(쿨다운 무관) — 에러 메시지 구분용
  let readyK = -1; // 소유 + 쿨다운 완료
  for (let k = 0; k < s.nukeSilos.length; k++) {
    const idx = s.nukeSilos[k];
    if (idx < 0 || s.ownerId[idx] !== holderId) continue;
    if (ownedK < 0) ownedK = k;
    if (nowMs >= s.nukeReadyAt[k]) {
      readyK = k;
      break;
    }
  }
  if (ownedK < 0) return { ok: false, reason: "전술핵 사일로(제주)를 보유해야 발사할 수 있습니다." };
  if (readyK < 0) {
    const left = Math.ceil((s.nukeReadyAt[ownedK] - nowMs) / 1000);
    return { ok: false, reason: `전술핵 재장전까지 ${left}초 남았습니다.` };
  }

  const neutralized: number[] = [];
  for (const h of hits) {
    if (h < 0 || h >= s.n) continue;
    if (isShielded(s, s.ownerId[h], wallNowMs)) continue; // 방어막 보호 — 중립화 안 됨
    s.ownerId[h] = NEUTRAL_HOLDER_ID;
    s.troops[h] = 0;
    s.troopAccum[h] = 0;
    s.dirty.add(h);
    neutralized.push(h);
  }
  s.nukeReadyAt[readyK] = nowMs + CONFIG.NUKE_COOLDOWN_SEC * 1000;
  const siloName = s.meta[s.nukeSilos[readyK]]?.name ?? "?";
  pushLog(s, `☢ 전술핵 착탄(${siloName} 발사) — ${neutralized.length}개 동 중립화`, wallNowMs);
  return { ok: true, silo: s.nukeSilos[readyK], readyAtMs: s.nukeReadyAt[readyK], neutralized };
}

// ── 공격 목표 자동 보급 ────────────────────────────────────────────────
// 공격 목표(attackQueue)를 지정하면, 후방 병력이 매 보급 tick마다 내 영토 경사를 따라 가장 가까운
// 공격 전선(공격 목표에 인접한 내 동)으로 한 홉씩 자동 전진한다. 내 소유 동 사이에서만 흐르므로
// 전투는 없다 — 전선에 모인 병력은 tickAttackQueue가 목표로 내보낸다. (예전 집결지(rally) 대체.)

// 공격 목표를 가진 모든 holder에 대해 후방 병력을 전선 방향으로 한 홉씩 전진시킨다(SUPPLY_INTERVAL_SEC 주기).
// 반환 = 이번 주기에 새로 출발한 보급 유닛(order) — 호출자가 DELTA newOrders로 실어 보낸다.
export function tickSupply(s: GameState, nowMs: number): Order[] {
  const out: Order[] = [];
  for (let h = 0; h < s.attackQueue.length; h++) {
    if (s.attackQueue[h].size === 0) continue;
    supplyTowardFronts(s, h, s.attackQueue[h], nowMs, out);
  }
  return out;
}

// 전선(공격 목표에 인접한 내 동) = 거리 0인 다중 소스에서 내 영토 위로 BFS 홉거리를 구하고, 각 후방
// 동이 '전선에 한 칸 더 가까운' 이웃으로 병력 일부를 행군(order)시킨다 — 여러 목표가 있으면 각 후방
// 동은 가장 가까운 목표 쪽으로 흐른다. 순간이동이 아니라 유닛이 이동 시간을 두고 도착하며, 도착 처리는
// tickOrders/resolveArrival가 일반 출정과 똑같이 담당한다(증원·상한 초과분 반환).
function supplyTowardFronts(
  s: GameState,
  holderId: number,
  targets: Set<number>,
  nowMs: number,
  out: Order[]
) {
  const dist = new Int32Array(s.n).fill(-1);
  const q: number[] = [];
  // 전선: 공격 목표에 인접한 내 동(거리 0). 여러 목표에서 동시에 퍼지는 다중 소스 BFS.
  for (const target of targets) {
    if (target < 0 || target >= s.n) continue;
    for (const nb of s.neighborIndex[target]) {
      if (s.ownerId[nb] === holderId && dist[nb] === -1) {
        dist[nb] = 0;
        q.push(nb);
      }
    }
  }
  for (let k = 0; k < q.length; k++) {
    const cur = q[k];
    for (const nb of s.neighborIndex[cur]) {
      if (dist[nb] !== -1 || s.ownerId[nb] !== holderId) continue;
      dist[nb] = dist[cur] + 1;
      q.push(nb);
    }
  }
  // 후방 동(거리>0)만 전진시킨다 — 전선(거리 0)의 병력은 tickAttackQueue가 목표 공격에 쓴다.
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    if (dist[i] <= 0) continue;
    if (s.troops[i] <= CONFIG.SUPPLY_MIN_TROOPS) continue;
    let j = -1; // 전선에 한 칸 더 가까운 이웃
    for (const nb of s.neighborIndex[i]) {
      if (dist[nb] === dist[i] - 1) {
        j = nb;
        break;
      }
    }
    if (j < 0) continue;
    const space = s.troopCap[j] - s.troops[j];
    if (space <= 0) continue; // 앞이 가득 차면 출발 안 함(불필요한 왕복 방지)
    let amt = Math.floor(s.troops[i] * CONFIG.SUPPLY_RATIO);
    if (amt < 1) continue;
    if (amt > space) amt = space;
    // 병력은 즉시 출발지를 떠나(차감) 이웃으로 행군한다. 도착 시 tickOrders가 증원 처리(초과분 반환).
    s.troops[i] -= amt;
    s.dirty.add(i);
    const order = makeOrder(s, i, j, amt, holderId, nowMs);
    s.orders.push(order);
    out.push(order);
  }
}

// ── 공격 큐 ────────────────────────────────────────────────────────────
// 국경에 인접한 적·중립 지역을 큐에 넣으면, 매 주기 그 지역에 인접한 내 동들의 병력 일부가
// 자동으로 그 지역을 공격한다(도착 시 전투는 일반 출정과 동일). 대상이 내 소유가 되면 자동 제거.

export type AttackQueueResult =
  | { ok: true; added: boolean } // added=true 추가, false 제거(해제)
  | { ok: false; reason: string };

// 공격 대상 토글. 이미 큐에 있으면 해제(항상 허용), 없으면 적·중립 + 내 영토 인접일 때만 추가.
export function toggleAttackTarget(s: GameState, holderId: number, idx: number): AttackQueueResult {
  if (idx < 0 || idx >= s.n) return { ok: false, reason: "잘못된 대상입니다." };
  const q = s.attackQueue[holderId];
  if (q.has(idx)) {
    q.delete(idx);
    return { ok: true, added: false };
  }
  if (s.ownerId[idx] === holderId) return { ok: false, reason: "적·중립 지역만 공격 대상으로 지정할 수 있습니다." };
  let adjacent = false;
  for (const nb of s.neighborIndex[idx]) {
    if (s.ownerId[nb] === holderId) {
      adjacent = true;
      break;
    }
  }
  if (!adjacent) return { ok: false, reason: "내 영토에 인접한 지역만 공격할 수 있습니다." };
  q.add(idx);
  return { ok: true, added: true };
}

// 큐를 가진 모든 holder에 대해, 각 대상에 인접한 내 동들이 병력 일부를 그 대상으로 출정시킨다.
// (시뮬레이터가 ATTACK_QUEUE_INTERVAL_SEC 주기로 호출.) 반환 = 이번 주기에 새로 출발한 order.
export function tickAttackQueue(s: GameState, nowMs: number): Order[] {
  const out: Order[] = [];
  for (let h = 0; h < s.attackQueue.length; h++) {
    const q = s.attackQueue[h];
    if (q.size === 0) continue;
    for (const target of Array.from(q)) {
      if (target < 0 || target >= s.n) {
        q.delete(target);
        continue;
      }
      if (s.ownerId[target] === h) {
        q.delete(target); // 점령 완료 → 큐에서 제거
        continue;
      }
      // 대상에 인접한 내 동마다 병력 일부를 출정(도착 시 resolveArrival가 전투 처리).
      let hasFront = false; // 대상에 인접한 내 동(공격 발판)이 하나라도 있는가
      for (const nb of s.neighborIndex[target]) {
        if (s.ownerId[nb] !== h) continue;
        hasFront = true;
        if (s.troops[nb] <= CONFIG.ATTACK_QUEUE_MIN_TROOPS) continue;
        const amt = Math.floor(s.troops[nb] * CONFIG.ATTACK_QUEUE_RATIO);
        if (amt < 1) continue;
        s.troops[nb] -= amt;
        s.dirty.add(nb);
        const order = makeOrder(s, nb, target, amt, h, nowMs);
        s.orders.push(order);
        out.push(order);
      }
      if (!hasFront) q.delete(target); // 인접 내 영토를 다 잃음(공격 발판 상실) → 큐에서 제거
    }
  }
  return out;
}

// ── 공수부대 (B3) ──────────────────────────────────────────────────────
// 원으로 고른 내 동들(sources)의 병력 전부를 모아 삼각형 유닛으로 dest에 투하한다. 도착 시
// resolveAirdrop이 목적지→인접 BFS로 순차 flood한다(적/중립은 전투로 점령, 내 동은 상한까지 증원).

export type AirdropResult =
  | { ok: true }
  | { ok: false; reason: string; code: "AIRDROP_COOLDOWN" | "NO_TROOPS" | "AIRDROP_RANGE" };

// 공수 발주. sources는 호출자(전송 계층)가 내 소유로 걸러 보낸 목록이라고 가정하되 여기서도 재확인한다.
// 쿨타임이 남아 있으면 거부. 성공 시 sources 병력 전부를 빼고 삼각형 order 1개를 띄운다.
export function tryAirdrop(
  s: GameState,
  sources: number[],
  dest: number,
  holderId: number,
  nowMs: number
): AirdropResult {
  if (nowMs < s.airdropReadyAt[holderId]) {
    const left = Math.ceil((s.airdropReadyAt[holderId] - nowMs) / 1000);
    return { ok: false, reason: `공수 재사용까지 ${left}초 남았습니다.`, code: "AIRDROP_COOLDOWN" };
  }
  if (dest < 0 || dest >= s.n) return { ok: false, reason: "투하 목적지가 올바르지 않습니다.", code: "NO_TROOPS" };

  const valid: number[] = [];
  let total = 0;
  for (const i of sources) {
    if (i < 0 || i >= s.n || s.ownerId[i] !== holderId) continue;
    valid.push(i);
    total += s.troops[i];
  }
  if (total <= 0) return { ok: false, reason: "수송할 병력이 없습니다.", code: "NO_TROOPS" };

  const origin = nearestSourceToCentroid(s, valid, holderId); // 삼각형 유닛 출발 위치(원 중심 근사)
  // 사일로 섬(제주) 예외 — 그 섬으로 보내거나 그 섬에서 출발하는 공수는 사거리 무제한.
  // (두 섬은 본토와 인접이 끊겨 있어 공수 외 도달 수단이 없다 — 전술핵 사일로 쟁탈전의 통로.)
  const rangeExempt = s.nukeIslandMask[origin] === 1 || s.nukeIslandMask[dest] === 1;
  if (!rangeExempt && airdropScaledDist(s, origin, dest) > CONFIG.AIRDROP_MAX_RANGE_DEG) {
    return { ok: false, reason: "공수 사거리를 벗어났습니다 — 더 가까운 목적지를 선택하세요.", code: "AIRDROP_RANGE" };
  }
  // 밸런스 — 한 번에 최대 AIRDROP_MAX_TROOPS까지만 싣는다. 초과분은 출발 동에 그대로 남는다.
  const amount = Math.min(total, CONFIG.AIRDROP_MAX_TROOPS);
  let capacity = amount;
  for (const i of valid) {
    if (capacity <= 0) break;
    const take = Math.min(s.troops[i], capacity);
    if (take > 0) {
      s.troops[i] -= take;
      capacity -= take;
      s.dirty.add(i);
    }
  }
  s.airdropReadyAt[holderId] = nowMs + CONFIG.AIRDROP_COOLDOWN_SEC * 1000;

  // 공수는 일반 유닛보다 조금 느리게(전용 속도·상한) 날아가 수송이 또렷이 보이게 한다.
  const order = makeOrder(
    s,
    origin,
    dest,
    amount,
    holderId,
    nowMs,
    undefined,
    CONFIG.AIRDROP_SPEED_DEG_PER_SEC,
    CONFIG.AIRDROP_TRAVEL_MAX_SEC
  );
  order.airdrop = true;
  s.orders.push(order);
  return { ok: true };
}

// 선택 동들의 무게중심에 가장 가까운 소유 동 — 삼각형 유닛의 출발 위치(원 중심 근사)로 쓴다.
function nearestSourceToCentroid(s: GameState, sources: number[], holderId: number): number {
  let sx = 0;
  let sy = 0;
  let cnt = 0;
  for (const i of sources) {
    if (i < 0 || i >= s.n || s.ownerId[i] !== holderId) continue;
    sx += s.meta[i].centroid[0];
    sy += s.meta[i].centroid[1];
    cnt++;
  }
  if (cnt === 0) return sources[0] ?? 0;
  const cx = sx / cnt;
  const cy = sy / cnt;
  let best = sources[0];
  let bestD = Infinity;
  for (const i of sources) {
    if (i < 0 || i >= s.n || s.ownerId[i] !== holderId) continue;
    const c = s.meta[i].centroid;
    const d = (c[0] - cx) * (c[0] - cx) + (c[1] - cy) * (c[1] - cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// 공수 사거리 판정(클라 UX용) — 삼각형 출발 동(origin)에서 dest까지 거리가 상한 이내인가.
// tryAirdrop과 같은 origin·거리 기준을 써서 클라 하이라이트와 서버 검증이 어긋나지 않게 한다.
// 공수 사거리용 거리 — 화면에 그리는 사거리 원(경도를 cosLat로 보정한 둥근 원)과 같은 척도로 잰다.
// 그래야 "원에 걸침 = 수송 가능"이 정확히 일치한다. cosLat은 origin 위도 기준(원을 그 위도로 그린다).
function airdropScaledDist(s: GameState, origin: number, dest: number): number {
  const a = s.meta[origin].centroid;
  const b = s.meta[dest].centroid;
  const cosLat = Math.cos((a[1] * Math.PI) / 180);
  const dx = (a[0] - b[0]) * cosLat;
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function airdropInRange(s: GameState, sources: number[], dest: number, holderId: number): boolean {
  if (dest < 0 || dest >= s.n) return false;
  const valid = sources.filter((i) => i >= 0 && i < s.n && s.ownerId[i] === holderId);
  if (valid.length === 0) return false;
  const origin = nearestSourceToCentroid(s, valid, holderId);
  // 사일로 섬(제주) 출발/도착은 사거리 무제한 — tryAirdrop과 같은 규칙(클라 UX 일치).
  if (s.nukeIslandMask[origin] === 1 || s.nukeIslandMask[dest] === 1) return true;
  return airdropScaledDist(s, origin, dest) <= CONFIG.AIRDROP_MAX_RANGE_DEG;
}

// 공수 삼각형 출발 동(사거리 원의 중심) — airdropInRange/tryAirdrop과 같은 origin. 유효 소스 없으면 -1.
export function airdropOrigin(s: GameState, sources: number[], holderId: number): number {
  const valid = sources.filter((i) => i >= 0 && i < s.n && s.ownerId[i] === holderId);
  if (valid.length === 0) return -1;
  return nearestSourceToCentroid(s, valid, holderId);
}

// 공수 착륙: dest에 투하하고 상한 초과분을 목적지→인접 BFS로 순차 flood한다. 단일 스트림(remaining)이
// BFS 순서로 각 동을 처리 — 내 동이면 상한까지 증원, 적/중립이면 전투(투하량>방어면 점령 후 상한까지
// 주둔). 남은 병력 ≤ 방어면 그 동 방어를 깎고 소진·종료. 병력 소진 또는 더 퍼질 동이 없으면 끝.
function resolveAirdrop(s: GameState, dest: number, amount: number, holderId: number, wallNowMs: number) {
  let remaining = amount;
  const visited = new Uint8Array(s.n);
  const queue = [dest];
  visited[dest] = 1;
  let captured = 0;
  let reinforced = 0;

  for (let qi = 0; qi < queue.length && remaining > 0; qi++) {
    const d = queue[qi];
    if (s.ownerId[d] === holderId) {
      const space = Math.max(0, s.troopCap[d] - s.troops[d]);
      const add = Math.min(remaining, space);
      if (add > 0) {
        s.troops[d] += add;
        remaining -= add;
        s.dirty.add(d);
        reinforced++;
      }
      for (const nb of s.neighborIndex[d]) if (!visited[nb]) { visited[nb] = 1; queue.push(nb); }
    } else {
      // 방어막은 미사일 전용 — 공수도 유닛 공격이라 방어막 셀에 정상 투하·전투한다.
      const defenders = s.troops[d];
      if (remaining > defenders) {
        s.ownerId[d] = holderId;
        remaining -= defenders;
        const garrison = Math.min(s.troopCap[d], remaining);
        s.troops[d] = garrison;
        remaining -= garrison;
        s.dirty.add(d);
        captured++;
        for (const nb of s.neighborIndex[d]) if (!visited[nb]) { visited[nb] = 1; queue.push(nb); }
      } else {
        s.troops[d] = defenders - remaining; // 점령 실패 — 방어 병력만 깎고 스트림 소진
        remaining = 0;
        s.dirty.add(d);
      }
    }
  }
  pushLog(s, `공수 착륙 — ${captured}개 동 점령, ${reinforced}개 동 증원`, wallNowMs);
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

// 소유 동 0개가 된 플레이어(미사일 직격 등으로 유일한 동을 잃은 경우)의 재시작 요청(C→S
// RestartCommand)을 처리한다 — SORTIE는 내 소유 동에서만 가능해서, 0개가 되면 아무것도 할
// 수 없다. 예전엔 매 tick 자동으로 재배정했지만, 그러면 "게임오버" 순간이 없어져 유저가
// 직접 재시작을 선택하는 느낌이 안 나서 유저 명시 요청 시에만 배정하도록 바꿨다(worldView.ts
// 패배 오버레이 참고). 아직 살아있으면(소유 동 > 0) 무시. E(255)는 대상 아님(재스폰 없음).
export function respawnPlayer(s: GameState, holderId: number, wallNowMs: number): boolean {
  const holder = s.holders.get(holderId);
  if (!holder || holderId === NEUTRAL_HOLDER_ID || holderId === CONFIG.ENV_HOLDER_ID) return false;
  if (ownedCount(s, holderId) > 0) return false; // 아직 안 죽음 — 무시

  // 신규 참가와 같은 배정 규칙 — 본토에서만(섬 제외), 기존 플레이어와 멀리.
  const newCell = pickStartCell(s);
  if (newCell === null) return false; // 본토에 빈 중립 셀이 없으면 실패
  s.ownerId[newCell] = holderId;
  s.troops[newCell] = s.troopCap[newCell];
  s.dirty.add(newCell);
  applyShield(s, holderId, wallNowMs);
  pushLog(s, `${holder.name}님이 재시작해 ${s.meta[newCell].name}에서 다시 시작합니다.`, wallNowMs);
  return true;
}

// ── 스폰 방어막 ───────────────────────────────────────────────────────
// 신규 참가(createGameState)·재시작(respawnPlayer) 직후 SPAWN_SHIELD_SEC 동안 그 플레이어의
// 동은 미사일·전술핵 중립화와 포위 귀속으로부터 보호된다. 유닛 공격(출정·행군·공수)은
// 방어막과 무관하게 정상 전투 — 방어막은 원거리 즉사 수단만 막는다. 시작 계기가
// 뭐든 규칙은 하나 — 이 함수 하나로 부여한다.
export function applyShield(s: GameState, holderId: number, wallNowMs: number): ShieldInfo {
  const until = wallNowMs + CONFIG.SPAWN_SHIELD_SEC * 1000;
  s.shieldUntil[holderId] = until;
  return { holderId, until };
}

// holderId가 지금(nowMs 기준) 방어막으로 보호되는 실제 플레이어인가.
function isShielded(s: GameState, holderId: number, nowMs: number): boolean {
  return isRealPlayer(holderId) && nowMs < s.shieldUntil[holderId];
}

// README §4.6, §8 — 순위표는 중립·환경 세력(E)을 제외한 플레이어만.
export function getLeaderboard(s: GameState): LeaderboardRow[] {
  return Array.from(s.holders.values())
    .filter((h) => h.id !== NEUTRAL_HOLDER_ID && h.id !== CONFIG.ENV_HOLDER_ID)
    .map((h) => ({ holderId: h.id, name: h.name, count: ownedCount(s, h.id) }))
    .sort((a, b) => b.count - a.count);
}

// 라운드 지배 판정(라운드제) — 1위가 전국의 ROUND_WIN_RATIO 이상 점유 시 그 holderId, 아니면 -1.
// 시간 종료(ROUND_DURATION_SEC)는 시각 비교라 루프(서버)에서 따로 처리한다.
export function dominationHolder(s: GameState): number {
  if (s.n === 0) return -1;
  const leader = getLeaderboard(s)[0];
  if (!leader) return -1;
  const threshold = Math.ceil(s.n * CONFIG.ROUND_WIN_RATIO);
  return leader.count >= threshold ? leader.holderId : -1;
}

// README §6 — 계급은 저장하지 않고 소유권에서 매번 파생.
export function computeRank(s: GameState, holderId: number): Rank {
  if (holderId === NEUTRAL_HOLDER_ID || s.n === 0) return null;

  const sidoTotal = new Map<string, number>();
  const sidoOwned = new Map<string, number>();
  let anyOwned = false;
  let ownedCells = 0;

  for (let i = 0; i < s.n; i++) {
    const sido = s.meta[i].sidocd;
    sidoTotal.set(sido, (sidoTotal.get(sido) ?? 0) + 1);
    if (s.ownerId[i] === holderId) {
      anyOwned = true;
      ownedCells++;
      sidoOwned.set(sido, (sidoOwned.get(sido) ?? 0) + 1);
    }
  }
  if (!anyOwned) return null;

  // 전국 완전 장악(100%)은 사실상 불가능에 가까우므로, 전체 동의 PRESIDENT_WIN_RATIO(40%)
  // 이상을 점유하면 대통령으로 인정한다(README §6 완화 — worldView.drainVictory가 우승 판정에도 재사용).
  const presidentThreshold = Math.ceil(s.n * CONFIG.PRESIDENT_WIN_RATIO);
  if (ownedCells >= presidentThreshold) return "대통령";

  let fullSido = 0;
  for (const [sido, total] of sidoTotal) {
    if ((sidoOwned.get(sido) ?? 0) === total) fullSido++;
  }
  if (fullSido > 0) return "도지사"; // 시도(예: 강원도) 하나를 통째로 장악

  // 법정동 시절엔 "시군구 하나 통째로 장악=시장"이었지만, 시/군/구 지도는 셀 하나가 이미
  // 시군구 하나 전체라 그 판정이 땅을 조금이라도 가지면 항상 참이 된다 — 그래서 시장 계급은
  // 보유 개수(MAYOR_RANK_CELLS) 기준으로 대체하고, 그 아래는 구청장(시/군/구 진입 단계)이다.
  if (ownedCells >= CONFIG.MAYOR_RANK_CELLS) return "시장";

  return "구청장";
}

// ── 환경 세력 (E) — README §4.6 ──────────────────────────────────────
// 문명 야만인형 초반 조연. 상한(하드캡·never-surpass)이 있어 맵을 장악하지 못한다.

// ── 포위 귀속 (Encirclement Capture) ─────────────────────────────────
// 어떤 플레이어 P가 '자기 동만으로' 완전히 둘러싼 영역이, 전부 단일 실제 플레이어 Q
// (중립·야만인 제외) 소유이고, 그 상태를 ANNEX_HOLD_SEC초 연속 유지하면 그 영역 전체를
// P가 흡수한다(병력 0 리셋). 크기 제한 없음(전면 스윙 허용). 시뮬레이터(목/서버)가 매 tick 호출.
// nowMs=단조 시각(유지 시간 측정), wallNowMs=로그 타임스탬프. 흡수된 admIndex 목록 반환.
export function tickAnnex(s: GameState, nowMs: number, wallNowMs: number): number[] {
  const curBy = new Int32Array(s.n).fill(-1); // 이번 프레임에 각 동을 포위 중인 holderId(-1=없음)

  const players = realPlayerIds(s);
  // 포위하는 쪽(P)과 둘러싸이는 쪽(Q)이 둘 다 실제 플레이어여야 하므로 최소 2명 필요.
  if (players.length >= 2) {
    const visited = new Uint8Array(s.n);
    for (const P of players) {
      visited.fill(0);
      for (let start = 0; start < s.n; start++) {
        if (s.ownerId[start] === P || visited[start]) continue;
        // P가 아닌 동들의 연결요소를 BFS로 모은다(P 동은 '벽'이라 통과 불가).
        const comp: number[] = [];
        const owner0 = s.ownerId[start];
        let singleOwner = true;
        let touchesBorder = false;
        const stack: number[] = [start];
        visited[start] = 1;
        while (stack.length > 0) {
          const c = stack.pop() as number;
          comp.push(c);
          if (s.borderMask[c]) touchesBorder = true;
          if (s.ownerId[c] !== owner0) singleOwner = false;
          for (const nb of s.neighborIndex[c]) {
            if (s.ownerId[nb] !== P && visited[nb] === 0) {
              visited[nb] = 1;
              stack.push(nb);
            }
          }
        }
        // 경계(바깥)에 못 닿고(=P가 완전 봉쇄) + 전부 단일 실제 플레이어 소유 + 방어막 없음이면 포위 후보.
        if (!touchesBorder && singleOwner && isRealPlayer(owner0) && !isShielded(s, owner0, wallNowMs)) {
          for (const c of comp) curBy[c] = P;
        }
      }
    }
  }

  // 유지 타이머 갱신 + ANNEX_HOLD_SEC 유지 시 흡수.
  const holdMs = CONFIG.ANNEX_HOLD_SEC * 1000;
  const annexed: number[] = [];
  const groups = new Map<string, { p: number; q: number; count: number }>();
  for (let c = 0; c < s.n; c++) {
    const P = curBy[c];
    if (P < 0) {
      // 더는 포위 안 됨(벽이 뚫렸거나 조건 미충족) → 타이머 리셋.
      s.enclosedBy[c] = -1;
      s.enclosedSince[c] = 0;
      continue;
    }
    if (s.enclosedBy[c] !== P) {
      s.enclosedBy[c] = P; // 새로 포위 시작 → 유지 시간 0부터.
      s.enclosedSince[c] = nowMs;
    } else if (nowMs - s.enclosedSince[c] >= holdMs) {
      const q = s.ownerId[c];
      s.ownerId[c] = P; // 흡수: 소유권 이전, 병력 0부터 다시 시작.
      s.troops[c] = 0;
      s.troopAccum[c] = 0;
      s.enclosedBy[c] = -1;
      s.enclosedSince[c] = 0;
      s.dirty.add(c);
      annexed.push(c);
      const key = P + ":" + q;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { p: P, q, count: 1 });
    }
  }

  for (const g of groups.values()) {
    const pName = s.holders.get(g.p)?.name ?? "?";
    const qName = s.holders.get(g.q)?.name ?? "?";
    pushLog(s, `${pName}가 ${qName} 포위 — ${g.count}개 동 흡수`, wallNowMs);
  }
  return annexed;
}

// 실제 플레이어 = 중립(0)·환경 세력(255)이 아닌 holder.
function isRealPlayer(holderId: number): boolean {
  return holderId !== NEUTRAL_HOLDER_ID && holderId !== CONFIG.ENV_HOLDER_ID;
}

// 현재 동을 1개 이상 소유한 실제 플레이어 id 목록.
function realPlayerIds(s: GameState): number[] {
  const set = new Set<number>();
  for (let i = 0; i < s.n; i++) {
    const o = s.ownerId[i];
    if (isRealPlayer(o)) set.add(o);
  }
  return Array.from(set);
}

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

// ── AI 플레이어 (server .../domain/PlayerAi.kt 1:1 대응) ─────────────────────
// 야만인(E)을 대체한다. 한 세션을 target명까지 AI로 채우고(fillAiPlayers), 매 주기
// 확장(약한 인접 적/중립 다전선 출정)과 증원(프런티어 BFS로 후방→전선 병력 공급)을 한다.
// 미사일/전술핵/공수는 쓰지 않고, 생산량만 사람의 AI_PROD_MULT배(tickProduction에서 처리).

// AI 닉네임 풀 — 서버 PlayerAi.NAMES와 동일 순서.
const AI_NAMES = ["도전자", "맞수", "용병", "야망가", "정복자", "반란군", "책략가", "맹장"];

// 현재 실제 플레이어(사람+AI) 수 — 중립·(구)E 제외.
function playerCount(s: GameState): number {
  let c = 0;
  for (const h of s.holders.values()) {
    if (h.id !== NEUTRAL_HOLDER_ID && h.id !== CONFIG.ENV_HOLDER_ID) c++;
  }
  return c;
}

// 1..254에서 가장 작은 미사용 holderId (server World.allocateHolderId 대응, 목은 최소값 방식).
function allocateHolderId(s: GameState): number {
  for (let id = 1; id <= 254; id++) if (!s.holders.has(id)) return id;
  throw new Error("holderId 254개가 모두 사용 중입니다.");
}

// 시작 동 배정 — 본토(서울에서 인접 BFS로 도달)에서만, 랜덤하면서도 고르게(최원점 샘플링,
// server StartCellAssigner.pick 대응). 첫 배치는 무작위, 이후엔 "가장 가까운 기존
// 플레이어까지의 거리"가 충분히 먼 후보 중 무작위. 섬은 스폰 후보에서 제외한다.
const START_FAR_FRACTION = 0.6; // 최원점(제곱거리) 대비 이 비율 이상 떨어진 후보 = "충분히 먼 곳"
const SPAWN_ANCHOR_SIDOCD = "11"; // 서울 — BFS 시드(도달 가능한 곳이 곧 본토)
const SPAWN_EXCLUDE_SIDOCD = "50"; // 제주 — 시작 지점에서 명시적으로 제외

// 스폰 가능한 본토 판정 — 서울(sidocd "11")에서 인접 그래프로 BFS해 도달하는 셀 집합.
// 섬(서울과 인접이 끊긴 별도 컴포넌트)은 도달하지 못해 자연히 빠지고, 제주(sidocd "50")는
// 혹시 데이터상 연결돼 있더라도 명시적으로 제외한다. 인접은 정적이라 소유와 무관하게
// 그래프 구조만으로 계산한다. server StartCellAssigner.mainlandFromSeoul 대응.
export function mainlandFromSeoul(
  neighborIndex: readonly (readonly number[])[],
  meta: readonly { sidocd: string }[],
  n: number
): Set<number> {
  const seen = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (meta[i].sidocd === SPAWN_ANCHOR_SIDOCD) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const nb of neighborIndex[queue[head]]) {
      if (!seen[nb]) {
        seen[nb] = 1;
        queue.push(nb);
      }
    }
  }
  const out = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (seen[i] && meta[i].sidocd !== SPAWN_EXCLUDE_SIDOCD) out.add(i);
  }
  return out;
}

export function pickStartCell(s: GameState): number | null {
  // 무조건 본토에서만 스폰 — 서울에서 BFS로 못 닿는 섬·제주는 후보에서 제외한다.
  const mainland = mainlandFromSeoul(s.neighborIndex, s.meta, s.n);
  const pool: number[] = [];
  for (let i = 0; i < s.n; i++) {
    if (s.ownerId[i] === NEUTRAL_HOLDER_ID && mainland.has(i)) pool.push(i);
  }
  if (pool.length === 0) return null; // 본토에 빈 중립 셀이 없음 — 섬엔 두지 않는다

  const refs: number[] = [];
  for (let i = 0; i < s.n; i++) {
    const o = s.ownerId[i];
    if (o !== NEUTRAL_HOLDER_ID && o !== CONFIG.ENV_HOLDER_ID) refs.push(i);
  }
  if (refs.length === 0) return pool[Math.floor(Math.random() * pool.length)]; // 첫 배치 — 무작위 시드

  let maxD = 0;
  const scored = pool.map((c) => {
    const d = nearestRefDistSq(s, c, refs);
    if (d > maxD) maxD = d;
    return [c, d] as [number, number];
  });
  const far = scored.filter(([, d]) => d >= maxD * START_FAR_FRACTION).map(([c]) => c);
  return far[Math.floor(Math.random() * far.length)];
}

// 후보 c에서 가장 가까운 기존 플레이어 동까지의 제곱거리(경위도).
function nearestRefDistSq(s: GameState, c: number, refs: number[]): number {
  const cc = s.meta[c].centroid;
  let min = Infinity;
  for (const r of refs) {
    const rc = s.meta[r].centroid;
    const dx = cc[0] - rc[0];
    const dy = cc[1] - rc[1];
    const d = dx * dx + dy * dy;
    if (d < min) min = d;
  }
  return min;
}

// 부족 인원을 AI 홀더로 채운다(server PlayerAi.fill 대응). 목은 라운드 개념이 없어 새 게임 시 1회 호출.
export function fillAiPlayers(s: GameState, target: number, wallNowMs: number) {
  let seq = 0;
  while (playerCount(s) < target) {
    const start = pickStartCell(s);
    if (start === null) break; // 맵이 가득 참
    const holderId = allocateHolderId(s);
    const name = AI_NAMES[seq % AI_NAMES.length];
    seq++;
    const paletteIdx = s.playerPaletteBag[(holderId - 1) % s.playerPaletteBag.length];
    s.holders.set(holderId, { id: holderId, name, paletteIdx, isAi: true });
    s.ownerId[start] = holderId;
    s.troops[start] = s.troopCap[start];
    s.dirty.add(start);
    applyShield(s, holderId, wallNowMs);
    pushLog(s, `${s.meta[start].name}에서 AI ${name}이(가) 참전했습니다.`, wallNowMs);
  }
}

// 성공한 출정 order를 out에 모은다(호출자가 DELTA에 실어 보낸다).
function aiSortieCapture(
  s: GameState,
  from: number,
  to: number,
  holderId: number,
  nowMs: number,
  out: Order[]
) {
  const before = s.orders.length;
  const res = trySortie(s, from, to, holderId, nowMs);
  if (res.ok && s.orders.length > before) out.push(s.orders[s.orders.length - 1]);
}

// Fisher-Yates 셔플(제자리). server의 MutableList.shuffle()에 대응.
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// 확장 — server PlayerAi.expand 대응. 일부러 비최적으로(마진 지터·무작위 대상·무작위 순서) 둬서
// 완벽한 타이밍에 최선 수만 두는 기계처럼 보이지 않게 한다.
function aiExpand(s: GameState, holderId: number, nowMs: number, out: Order[]) {
  const moves: { from: number; to: number }[] = [];
  for (let i = 0; i < s.n; i++) {
    if (s.ownerId[i] !== holderId) continue;
    const send = Math.floor(s.troops[i] * CONFIG.SORTIE_RATIO);
    if (send <= 0) continue;
    // 판단마다 마진을 흔든다 — 어떤 땐 지나치게 신중(좋은 기회를 흘림), 어떤 땐 무모(질 수도 있는데 강행).
    const margin = CONFIG.AI_ATTACK_MARGIN * (1 + (Math.random() * 2 - 1) * CONFIG.AI_ATTACK_MARGIN_JITTER);
    // i의 인접 중 이길 만한(마진 초과) 비소유 대상 전부.
    const beatable: number[] = [];
    for (const nb of s.neighborIndex[i]) {
      if (s.ownerId[nb] === holderId) continue;
      if (send > s.troops[nb] * margin) beatable.push(nb);
    }
    if (beatable.length === 0) continue;
    // 보통은 가장 약한 곳을 치지만, 확률적으로 아무 데나 골라 최적이 아닌 공격을 한다.
    let target = beatable[0];
    if (Math.random() < CONFIG.AI_RANDOM_TARGET_CHANCE) {
      target = beatable[Math.floor(Math.random() * beatable.length)];
    } else {
      for (const nb of beatable) if (s.troops[nb] < s.troops[target]) target = nb;
    }
    moves.push({ from: i, to: target });
  }
  // 이득 큰 순 정렬 대신 섞는다 — 한정된 출정 횟수를 늘 수학적 최선에만 쓰지 않게(비최적 자원 배분).
  shuffleInPlace(moves);
  let done = 0;
  const usedFrom = new Set<number>();
  for (const m of moves) {
    if (done >= CONFIG.AI_MAX_SORTIES_PER_TICK) break;
    if (usedFrom.has(m.from)) continue;
    usedFrom.add(m.from);
    aiSortieCapture(s, m.from, m.to, holderId, nowMs, out);
    done++;
  }
}

// 증원 — server PlayerAi.reinforce 대응(프런티어 BFS 거리 → 후방 가득 찬 동이 전선 쪽으로 한 홉).
function aiReinforce(s: GameState, holderId: number, nowMs: number, out: Order[]) {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (let i = 0; i < s.n; i++) {
    if (s.ownerId[i] !== holderId) continue;
    if (s.neighborIndex[i].some((nb) => s.ownerId[nb] !== holderId)) {
      dist.set(i, 0);
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const d = dist.get(c) as number;
    for (const nb of s.neighborIndex[c]) {
      if (s.ownerId[nb] === holderId && !dist.has(nb)) {
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  const candidates = Array.from(dist.entries())
    .filter(([i, d]) => d > 0 && s.troops[i] >= s.troopCap[i] * CONFIG.AI_REINFORCE_FILL_RATIO)
    .sort((a, b) => s.troops[b[0]] - s.troops[a[0]]);
  let done = 0;
  for (const [i, d] of candidates) {
    if (done >= CONFIG.AI_MAX_REINFORCE_PER_TICK) break;
    const target = s.neighborIndex[i].find((nb) => (dist.get(nb) ?? Infinity) < d);
    if (target === undefined) continue;
    aiSortieCapture(s, i, target, holderId, nowMs, out);
    done++;
  }
}

// 모든 AI 홀더가 한 번씩 행동(server PlayerAi.actAll 대응). nowMs=단조 시각(출정 타이밍).
// 새로 발주된 order 전부를 반환한다.
export function tickPlayerAi(s: GameState, nowMs: number): Order[] {
  const out: Order[] = [];
  for (const h of s.holders.values()) {
    if (!h.isAi) continue;
    // 매 주기 일정 확률로 이 AI는 통째로 쉰다 — 반응이 들쭉날쭉해져 기계적인 완벽한 타이밍이 사라진다.
    if (Math.random() < CONFIG.AI_HESITATE_CHANCE) continue;
    aiExpand(s, h.id, nowMs, out);
    aiReinforce(s, h.id, nowMs, out);
  }
  return out;
}
