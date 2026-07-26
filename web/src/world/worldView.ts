// 클라이언트 상태 반영 계층 (plan.md §3, architecture.md §2.3).
// 서버(목 서버 포함)가 보낸 WELCOME(전체 스냅샷)/DELTA(변경분)를 적용해 두는 곳.
// 클라는 여기서 게임 로직을 돌리지 않는다 — 그건 서버 몫. 여기 상태는 "서버 상태의 사본"이다.
//
// GameState와 같은 형태라, 순수 조회 함수(getLeaderboard/computeRank)는 core를 재사용한다.
// 단 troops/production을 여기서 tick하지 않는다(troopAccum은 사용 안 함).

import * as core from "../game/core";
import type { GameState } from "../game/core";
import type { DeltaMessage, WelcomeMessage } from "../net/protocol";

export interface WorldView extends GameState {
  myHolderId: number; // 이 클라이언트의 holderId (WELCOME에서 옴)
  myRally: number; // B2 — 내 집결지 admIndex(-1=없음). 렌더러가 깃발 마커를 그린다.
}

// 참조 고정 싱글턴 — applyWelcome이 필드를 제자리에서 덮어쓴다.
// (MapView·uiStore가 이 참조를 들고 world.ownerId 처럼 직접 읽는다.)
export const world: WorldView = Object.assign(core.createGameState(0, [], [], 0, 0), {
  myHolderId: 0,
  myRally: -1,
});

// 미사일이 얹힌 동 집합이 바뀌면(WELCOME/DELTA) set — 렌더러가 마커를 다시 그린다.
let missilesTouched = false;
// 내 집결지가 바뀌면(WELCOME/낙관적 지정) set — 렌더러가 깃발 마커를 다시 그린다.
let rallyTouched = false;

// WELCOME 적용 — 전체 스냅샷을 1회 반영. 이후 변경은 applyDelta로만.
export function applyWelcome(msg: WelcomeMessage) {
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
}

// 함락(소유권 변경)이 일어난 admIndex 큐 — 렌더러가 꺼내 플래시 연출에 쓴다.
export const captureFlashes: number[] = [];
// 미사일로 중립화된 동 큐 — 렌더러가 꺼내 폭발 충격파를 터뜨린다.
// (현재 규칙상 동이 중립(0)으로 바뀌는 건 오직 미사일뿐이므로 이게 착탄 신호가 된다.)
export const missileImpacts: number[] = [];
// 내가 소유 동 0개(궤멸)였다가 서버가 새 동을 배정해줘서 다시 생긴 admIndex 큐.
// (server GameCore.respawnEliminatedPlayers — 미사일 등으로 전멸해도 영구 탈락은 아니다.)
export const respawnEvents: number[] = [];

// DELTA 적용 — 변경된 동만 갱신하고 dirty에 모은다(렌더러가 배치 반영).
export function applyDelta(msg: DeltaMessage) {
  const hadNoCells = world.myHolderId !== 0 && core.ownedCount(world, world.myHolderId) === 0;

  // 신규 참가자 holder(색상 포함) 반영 — 이 DELTA의 cells에 그 holder의 첫 동이 같이
  // 실려 오므로, 아래 cells 루프가 색을 찾기 전에 먼저 world.holders에 채워둔다.
  for (const h of msg.newHolders) world.holders.set(h.id, h);

  for (const [admIndex, owner, troops] of msg.cells) {
    const prev = world.ownerId[admIndex];
    if (prev !== owner) {
      captureFlashes.push(admIndex); // 소유권 변경 = 함락
      if (owner === 0 && prev !== 0) missileImpacts.push(admIndex); // non-중립→중립 = 미사일 착탄
      if (hadNoCells && owner === world.myHolderId) respawnEvents.push(admIndex); // 궤멸 후 재시작
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
}

export function drainCaptureFlashes(): number[] {
  if (captureFlashes.length === 0) return [];
  return captureFlashes.splice(0, captureFlashes.length);
}

export function drainMissileImpacts(): number[] {
  if (missileImpacts.length === 0) return [];
  return missileImpacts.splice(0, missileImpacts.length);
}

export function drainRespawnEvents(): number[] {
  if (respawnEvents.length === 0) return [];
  return respawnEvents.splice(0, respawnEvents.length);
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
