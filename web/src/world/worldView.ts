// 클라이언트 상태 반영 계층 (plan.md §3, architecture.md §2.3).
// 서버(목 서버 포함)가 보낸 WELCOME(전체 스냅샷)/DELTA(변경분)를 적용해 두는 곳.
// 클라는 여기서 게임 로직을 돌리지 않는다 — 그건 서버 몫. 여기 상태는 "서버 상태의 사본"이다.
//
// GameState와 같은 형태라, 순수 조회 함수(getLeaderboard/computeRank)는 core를 재사용한다.
// 단 troops/production을 여기서 tick하지 않는다(troopAccum은 사용 안 함).

import * as core from "../game/core";
import type { GameState } from "../game/core";
import type { DeltaMessage, WelcomeMessage } from "../net/protocol";
import { CONFIG } from "../config";
import { applyServerConfig } from "../game/runtimeConfig";

export interface WorldView extends GameState {
  myHolderId: number; // 이 클라이언트의 holderId (WELCOME에서 옴)
  mapId: string; // 이 방이 쓰는 지도(data/loadMapData.ts MAP_ASSETS 키). Hud.tsx가 지도별 표시 분기에 쓴다.
  myRally: number; // B2 — 내 집결지 admIndex(-1=없음). 렌더러가 깃발 마커를 그린다.
  myAttackQueue: Set<number>; // 내 공격 큐 admIndex 집합. 렌더러가 ⚔️ 마커를 그린다.
  // 전술핵 사일로별 재발사 가능 시각을 로컬 시계(Date.now)로 환산한 값 — Hud 쿨다운 표시용.
  // (서버 nukeReadyAtMs는 serverTimeMs 시간축이라 받은 시점에 로컬로 번역해 둔다.)
  nukeReadyLocal: number[];
}

// 참조 고정 싱글턴 — applyWelcome이 필드를 제자리에서 덮어쓴다.
// (MapView·uiStore가 이 참조를 들고 world.ownerId 처럼 직접 읽는다.)
export const world: WorldView = Object.assign(core.createGameState(0, [], [], 0, 0), {
  myHolderId: 0,
  mapId: "kr-dong",
  myRally: -1,
  myAttackQueue: new Set<number>(),
  nukeReadyLocal: [] as number[],
});

// 미사일이 얹힌 동 집합이 바뀌면(WELCOME/DELTA) set — 렌더러가 마커를 다시 그린다.
let missilesTouched = false;
// 내 집결지가 바뀌면(WELCOME/낙관적 지정) set — 렌더러가 깃발 마커를 다시 그린다.
let rallyTouched = false;
// 내 공격 큐가 바뀌면(WELCOME/낙관적 토글/점령 정리) set — 렌더러가 ⚔️ 마커를 다시 그린다.
let attackQueueTouched = false;

// WELCOME 적용 — 전체 스냅샷을 1회 반영. 이후 변경은 applyDelta로만.
export function applyWelcome(msg: WelcomeMessage) {
  applyServerConfig(msg.config); // 지도별 오버라이드가 반영된 서버 원본 설정(runtimeConfig.ts 참조)
  world.mapId = msg.mapId;
  const n = msg.meta.length;
  world.n = n;
  world.ownerId = Uint8Array.from(msg.ownerId);
  world.troops = Uint16Array.from(msg.troops);
  world.troopCap = Uint16Array.from(msg.troopCap);
  world.troopAccum = new Float32Array(n); // 클라에서 미사용(서버가 생산 tick)
  world.neighborIndex = msg.neighborIndex;
  world.meta = msg.meta;
  world.holders = new Map(msg.holders.map((h) => [h.id, h]));
  world.orders = msg.orders.slice();
  world.missiles = new Uint8Array(n);
  for (const i of msg.missiles) world.missiles[i] = 1;
  missilesTouched = true;
  world.dirty = new Set<number>();
  for (let i = 0; i < n; i++) world.dirty.add(i); // 최초 1회 전체 리페인트
  world.logEntries = [];
  world.nextLogId = 1;
  world.myHolderId = msg.holderId;
  world.myRally = msg.rally ?? -1;
  rallyTouched = true;
  world.myAttackQueue = new Set(msg.attackQueue ?? []);
  attackQueueTouched = true;
  world.shieldUntil = new Float64Array(256);
  for (const sh of msg.shields) world.shieldUntil[sh.holderId] = sh.until;
  // 전술핵 사일로 — 위치·섬 마스크는 정적 데이터에서 재계산, 쿨다운은 로컬 시계로 환산해 저장.
  core.initNukeState(world);
  world.nukeReadyLocal = (msg.nukeReadyAtMs ?? []).map(
    (t) => Date.now() + (t - msg.serverTimeMs)
  );
  enclosedSet.clear(); // 재접속 스냅샷 — 포위 반짝임은 이후 DELTA(enclosed)로 다시 채운다
  enclosedTouched = true;
}

// 함락(소유권 변경)이 일어난 admIndex 큐 — 렌더러가 꺼내 플래시 연출에 쓴다.
export const captureFlashes: number[] = [];
// 미사일로 중립화된 동 큐 — 렌더러가 꺼내 폭발 충격파를 터뜨린다.
// (현재 규칙상 동이 중립(0)으로 바뀌는 건 오직 미사일뿐이므로 이게 착탄 신호가 된다.)
export const missileImpacts: number[] = [];
// 내 영토가 이번 delta에 전부 사라진 순간(패배) 신호 — App이 소진해 GAME OVER 오버레이를 띄운다.
// 재시작은 더 이상 자동이 아니라 유저가 오버레이에서 직접 선택해야 한다(connection.sendRestart).
let defeatFlag = false;
// 이번 delta에 내 점유율이 PRESIDENT_WIN_RATIO(40%)를 처음 넘어선 순간(우승) 신호 — App이 소진해
// 우승 오버레이를 띄운다. defeatFlag와 동일한 전이(transition) 패턴.
let victoryFlag = false;
// 재시작으로 새로 배정받은 시작 동의 admIndex 큐 — MapView가 꺼내 그 동으로 카메라를 옮긴다.
// (죽어있던 상태(소유 동 0개)에서만 채워지므로, 적 동을 뺏어 얻은 경우와 헷갈리지 않는다.)
export const respawnCellQueue: number[] = [];
// 현재 포위(귀속 대기)된 동 집합 — 서버 DELTA의 enclosed로 갱신. 렌더러가 이 동들을 반짝이게 한다.
export const enclosedSet = new Set<number>();
// 포위 집합이 바뀌면 set — 렌더러가 반짝임 대상(feature-state)을 다시 맞춘다.
let enclosedTouched = false;

// DELTA 적용 — 변경된 동만 갱신하고 dirty에 모은다(렌더러가 배치 반영).
export function applyDelta(msg: DeltaMessage) {
  const me = world.myHolderId;
  const wasAlive = me !== 0 && core.ownedCount(world, me) > 0; // 이번 delta 적용 전 생존 여부
  const presidentThreshold = Math.ceil(world.n * CONFIG.PRESIDENT_WIN_RATIO);
  const wasPresident = me !== 0 && core.ownedCount(world, me) >= presidentThreshold; // 적용 전 우승 여부

  // 신규 참가자 holder(색상 포함) 반영 — 이 DELTA의 cells에 그 holder의 첫 동이 같이
  // 실려 오므로, 아래 cells 루프가 색을 찾기 전에 먼저 world.holders에 채워둔다.
  for (const h of msg.newHolders) world.holders.set(h.id, h);

  // 미사일 착탄 연출: 서버가 명시적 목록(missileImpacts)을 주면 그걸 신뢰한다 — "이미 중립이던
  // 동"을 맞춰 소유권 변화가 없는 경우도 폭발이 뜬다. 목록이 없는(구버전) 서버는 아래 cells 루프의
  // 소유권 전이(non-중립→중립) 추론으로 폴백한다(둘을 겹쳐 쓰면 같은 동에 폭발이 두 번 뜬다).
  const explicitImpacts = msg.missileImpacts;
  if (explicitImpacts) for (const i of explicitImpacts) missileImpacts.push(i);

  for (const [admIndex, owner, troops] of msg.cells) {
    const prev = world.ownerId[admIndex];
    if (prev !== owner) {
      captureFlashes.push(admIndex); // 소유권 변경 = 함락
      if (!explicitImpacts && owner === 0 && prev !== 0) missileImpacts.push(admIndex); // 폴백: 전이 추론
      if (!wasAlive && owner === me) respawnCellQueue.push(admIndex); // 재시작으로 받은 새 동
    }
    world.ownerId[admIndex] = owner;
    world.troops[admIndex] = troops;
    world.dirty.add(admIndex);
  }
  if (msg.newOrders.length > 0) world.orders.push(...msg.newOrders);
  if (msg.events.length > 0) {
    // 서버가 최신순으로 보낸다고 가정하고 앞에 붙인다(README §8 append-only 로그).
    world.logEntries = [...msg.events, ...world.logEntries].slice(0, 30);
  }
  if (msg.missileAdd.length > 0 || msg.missileRemove.length > 0) {
    for (const i of msg.missileAdd) world.missiles[i] = 1;
    for (const i of msg.missileRemove) world.missiles[i] = 0;
    missilesTouched = true;
  }
  for (const sh of msg.shieldUpdates) world.shieldUntil[sh.holderId] = sh.until;
  // 전술핵 발사로 사일로 쿨다운이 바뀐 DELTA — 로컬 시계로 환산해 갱신.
  if (msg.nukeReadyAtMs) {
    world.nukeReadyLocal = msg.nukeReadyAtMs.map((t) => Date.now() + (t - msg.serverTimeMs));
  }
  // 포위 집합 갱신 — 필드가 실려 온 DELTA에서만 통째로 교체한다(없으면 기존 집합 유지).
  if (msg.enclosed) {
    enclosedSet.clear();
    for (const i of msg.enclosed) enclosedSet.add(i);
    enclosedTouched = true;
  }

  // 패배 판정: 이번 delta 적용 전엔 살아있었는데(소유 동 > 0) 적용 후 0개가 됐으면 궤멸 순간이다.
  // 더 이상 서버가 같은 delta에 새 동을 자동으로 얹어주지 않으므로 이 전이만 보면 된다.
  if (wasAlive && core.ownedCount(world, me) === 0) {
    defeatFlag = true;
  }

  // 우승 판정: 적용 전엔 40% 미만이었는데 적용 후 넘어섰으면 지금이 그 순간이다.
  if (!wasPresident && me !== 0 && core.ownedCount(world, me) >= presidentThreshold) {
    victoryFlag = true;
  }
}

export function drainCaptureFlashes(): number[] {
  if (captureFlashes.length === 0) return [];
  return captureFlashes.splice(0, captureFlashes.length);
}

// 포위 집합이 바뀌었으면 true 반환 후 플래그를 내린다(렌더러가 반짝임 대상을 다시 맞춘다).
export function drainEnclosedTouched(): boolean {
  if (!enclosedTouched) return false;
  enclosedTouched = false;
  return true;
}

export function drainMissileImpacts(): number[] {
  if (missileImpacts.length === 0) return [];
  return missileImpacts.splice(0, missileImpacts.length);
}

// 이번 delta에 내 영토가 전부 사라졌으면 true를 한 번 반환한다(App이 GAME OVER 오버레이를 띄운다).
export function drainDefeat(): boolean {
  if (!defeatFlag) return false;
  defeatFlag = false;
  return true;
}

// 이번 delta에 내 점유율이 처음 40%를 넘었으면 true를 한 번 반환한다(App이 우승 오버레이를 띄운다).
export function drainVictory(): boolean {
  if (!victoryFlag) return false;
  victoryFlag = false;
  return true;
}

// 재시작으로 새로 배정받은 시작 동의 admIndex를 반환한다(없으면 null). MapView가 카메라를 옮긴다.
export function drainRespawnCell(): number | null {
  if (respawnCellQueue.length === 0) return null;
  const drained = respawnCellQueue.splice(0, respawnCellQueue.length);
  return drained[drained.length - 1] ?? null; // 보통 1개뿐이지만, 혹시 여럿 쌓였으면 가장 최근 것
}

// 도착 시각이 지난 이동 유닛을 시각적으로 제거한다(api-spec §2.5).
// 실제 소유권/병력 변화는 서버 DELTA의 cells로 이미 반영된다.
export function pruneArrivedOrders(nowMs: number) {
  if (world.orders.length === 0) return;
  world.orders = world.orders.filter((o) => nowMs < o.arriveTick);
}

// 변경분 admIndex 목록을 꺼내 비운다(core 재사용 — world가 GameState 형태라 그대로 동작).
export const drainDirty = () => core.drainDirty(world);
export const getLeaderboard = () => core.getLeaderboard(world);
export const computeRank = (holderId: number) => core.computeRank(world, holderId);
export const envCellCount = () => core.envCellCount(world);

// 미사일 마커를 다시 그려야 하면 true 반환 후 플래그를 내린다(렌더러가 rAF에서 호출).
export function drainMissilesTouched(): boolean {
  if (!missilesTouched) return false;
  missilesTouched = false;
  return true;
}

// 내가 보유한 미사일 수 = 내 소유 동에 얹힌 미사일 수.
export const myMissileCount = () => core.missileCount(world, world.myHolderId);

// 전술핵 상태 요약(Hud용). owned=사일로(울릉도·제주) 보유 여부, cooldownLeftMs=남은 재장전(0=발사 가능).
// 둘 다 보유 시 더 빨리 준비되는 쪽 기준.
export function myNukeStatus(): { owned: boolean; cooldownLeftMs: number } {
  const mine = core.ownedNukeSilos(world, world.myHolderId);
  if (mine.length === 0) return { owned: false, cooldownLeftMs: 0 };
  let best = Infinity;
  for (let k = 0; k < world.nukeSilos.length; k++) {
    const idx = world.nukeSilos[k];
    if (idx < 0 || world.ownerId[idx] !== world.myHolderId) continue;
    const left = Math.max(0, (world.nukeReadyLocal[k] ?? 0) - Date.now());
    if (left < best) best = left;
  }
  return { owned: true, cooldownLeftMs: best === Infinity ? 0 : best };
}

// 공수 사거리 판정(렌더러 UX용) — 지금 선택한 출발 동들에서 dest가 사거리 이내인가.
export const airdropInRange = (sources: number[], dest: number) =>
  core.airdropInRange(world, sources, dest, world.myHolderId);

// 공수 사거리 원의 중심이 되는 출발 동 admIndex (없으면 -1).
export const airdropOrigin = (sources: number[]) => core.airdropOrigin(world, sources, world.myHolderId);

// 집결지 깃발 마커를 다시 그려야 하면 true 반환 후 플래그를 내린다(렌더러가 rAF에서 호출).
export function drainRallyTouched(): boolean {
  if (!rallyTouched) return false;
  rallyTouched = false;
  return true;
}

// 집결지를 낙관적으로 갱신한다(명령 전송 시 즉시 반영 — 서버 WELCOME이 최종 진실). idx<0 이면 해제.
export function setMyRally(idx: number) {
  world.myRally = idx;
  rallyTouched = true;
}

// ⚔️ 공격 큐 마커를 다시 그려야 하면 true 반환 후 플래그를 내린다(렌더러가 rAF에서 호출).
export function drainAttackQueueTouched(): boolean {
  if (!attackQueueTouched) return false;
  attackQueueTouched = false;
  return true;
}

// 공격 큐를 낙관적으로 토글한다(명령 전송 시 즉시 반영 — 서버 WELCOME이 최종 진실).
export function toggleMyAttackTarget(idx: number) {
  if (world.myAttackQueue.has(idx)) world.myAttackQueue.delete(idx);
  else world.myAttackQueue.add(idx);
  attackQueueTouched = true;
}

// 이미 내 소유가 된(점령 완료) 큐 대상을 정리한다 — 서버 tick도 제거하지만 마커를 즉시 지우기 위함.
// 바뀐 게 있으면 true 반환(렌더러가 마커를 다시 그리게).
export function pruneCapturedAttackTargets(): boolean {
  let changed = false;
  for (const t of Array.from(world.myAttackQueue)) {
    if (world.ownerId[t] === world.myHolderId) {
      world.myAttackQueue.delete(t);
      changed = true;
    }
  }
  if (changed) attackQueueTouched = true;
  return changed;
}

