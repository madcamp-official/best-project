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
}

// 참조 고정 싱글턴 — applyWelcome이 필드를 제자리에서 덮어쓴다.
// (MapView·uiStore가 이 참조를 들고 world.ownerId 처럼 직접 읽는다.)
export const world: WorldView = Object.assign(core.createGameState(0, [], [], 0, 0), {
  myHolderId: 0,
});

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
  world.dirty = new Set<number>();
  for (let i = 0; i < n; i++) world.dirty.add(i); // 최초 1회 전체 리페인트
  world.logEntries = [];
  world.nextLogId = 1;
  world.myHolderId = msg.holderId;
}

// DELTA 적용 — 변경된 동만 갱신하고 dirty에 모은다(렌더러가 배치 반영).
export function applyDelta(msg: DeltaMessage) {
  for (const [admIndex, owner, troops] of msg.cells) {
    world.ownerId[admIndex] = owner;
    world.troops[admIndex] = troops;
    world.dirty.add(admIndex);
  }
  if (msg.newOrders.length > 0) world.orders.push(...msg.newOrders);
  if (msg.events.length > 0) {
    // 서버가 최신순으로 보낸다고 가정하고 앞에 붙인다(README §8 append-only 로그).
    world.logEntries = [...msg.events, ...world.logEntries].slice(0, 30);
  }
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
