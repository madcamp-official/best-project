import * as core from "./core";
import type { GameState } from "./core";
import type { DongStaticMeta } from "./types";

// ── 클라이언트 세션 어댑터 ────────────────────────────────────────────
// 헥사고날 코어(core.ts)를 브라우저에 붙이는 얇은 경계층.
// · 단일 세션 상태 `game`을 들고 (initGame이 제자리에서 갱신하므로 참조는 고정),
//   어댑터(MapView·uiStore·App)는 game.ownerId 처럼 필드를 직접 읽는다.
// · 브라우저 시계(performance.now / Date.now)는 오직 여기서만 읽어 코어로 주입한다.
// 서버(권위)는 core.createGameState로 자기 GameState를 따로 만들어 같은 규칙 함수를 호출한다.

export type { GameState, SortieResult, LeaderboardRow } from "./core";

// 참조 고정 싱글턴 — initGame이 Object.assign으로 필드만 덮어써 갱신한다.
export const game: GameState = core.createGameState(0, [], [], 0, 0);

export function initGame(
  n: number,
  neighborIndex: number[][],
  meta: DongStaticMeta[],
  startIndex: number
) {
  Object.assign(game, core.createGameState(n, neighborIndex, meta, startIndex, Date.now()));
}

// 순수(시계 불필요) — 그대로 위임.
export const pickStartIndex = core.pickStartIndex;

// 시계가 필요한 규칙은 여기서 브라우저 시계를 주입해 코어로 넘긴다.
export const tickProduction = (dtSec: number) => core.tickProduction(game, dtSec);
export const trySortie = (from: number, to: number, holderId: number) =>
  core.trySortie(game, from, to, holderId, performance.now());
export const tickOrders = (nowMs: number) => core.tickOrders(game, nowMs, Date.now());
export const drainDirty = () => core.drainDirty(game);
export const getLeaderboard = () => core.getLeaderboard(game);
export const computeRank = (holderId: number) => core.computeRank(game, holderId);
