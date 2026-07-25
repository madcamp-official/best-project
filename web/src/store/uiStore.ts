import { create } from "zustand";
import { world, computeRank } from "../world/worldView";
import type { LogEntry, Rank } from "../game/types";

export interface SelectedInfo {
  index: number;
  name: string;
  ownerName: string;
  isMine: boolean;
  troops: number;
  cap: number;
}

// 순위표 한 줄 — 서버 LEADERBOARD 메시지(holderId/name/count)에 색 슬롯(paletteIdx)을 붙인 것.
export interface LeaderboardRowUI {
  holderId: number;
  name: string;
  count: number;
  paletteIdx: number;
}

// README.md §1 기술 스택 — "UI 상태(선택 동, HUD)"만 Zustand에 둔다.
// 3,500개 동 배열 자체는 world/worldView.ts(React 밖, 서버 상태 사본)에 두고 요약만 끌어온다.
interface UIState {
  phase: "loading" | "join" | "ready" | "error";
  errorMessage: string | null;
  selectedIndex: number | null;
  selectedInfo: SelectedInfo | null;
  leaderboard: LeaderboardRowUI[];
  envCells: number; // 환경 세력(E) 잔존 동 수 (README §8)
  totalCells: number;
  myHolderId: number;
  myRank: Rank;
  logEntries: LogEntry[];
  toast: string | null;

  setPhase: (phase: UIState["phase"], errorMessage?: string) => void;
  select: (index: number | null) => void;
  refreshSummary: () => void;
  // 서버 LEADERBOARD 메시지 반영 (rows는 중립·E 제외된 플레이어 순위).
  setLeaderboard: (
    rows: { holderId: number; name: string; count: number }[],
    envCells: number,
    totalCells: number
  ) => void;
  showToast: (message: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUIStore = create<UIState>((set, get) => ({
  phase: "loading",
  errorMessage: null,
  selectedIndex: null,
  selectedInfo: null,
  leaderboard: [],
  envCells: 0,
  totalCells: 0,
  myHolderId: 0,
  myRank: null,
  logEntries: [],
  toast: null,

  setPhase: (phase, errorMessage) => set({ phase, errorMessage: errorMessage ?? null }),

  select: (index) => {
    set({ selectedIndex: index });
    get().refreshSummary();
  },

  refreshSummary: () => {
    const { selectedIndex } = get();
    const selectedInfo: SelectedInfo | null =
      selectedIndex === null || selectedIndex >= world.n
        ? null
        : {
            index: selectedIndex,
            name: world.meta[selectedIndex].name,
            ownerName: world.holders.get(world.ownerId[selectedIndex])?.name ?? "?",
            isMine: world.ownerId[selectedIndex] === world.myHolderId,
            troops: world.troops[selectedIndex],
            cap: world.troopCap[selectedIndex],
          };

    // 순위표는 서버 LEADERBOARD로 갱신되므로 여기서 건드리지 않는다.
    set({
      selectedInfo,
      myHolderId: world.myHolderId,
      myRank: computeRank(world.myHolderId),
      logEntries: world.logEntries,
    });
  },

  setLeaderboard: (rows, envCells, totalCells) => {
    const leaderboard: LeaderboardRowUI[] = rows.map((r) => ({
      ...r,
      paletteIdx: world.holders.get(r.holderId)?.paletteIdx ?? 0,
    }));
    set({ leaderboard, envCells, totalCells });
  },

  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },
}));
