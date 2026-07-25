import { create } from "zustand";
import { world, getLeaderboard, computeRank } from "../world/worldView";
import type { LeaderboardRow } from "../game/core";
import type { LogEntry, Rank } from "../game/types";

export interface SelectedInfo {
  index: number;
  name: string;
  ownerName: string;
  isMine: boolean;
  troops: number;
  cap: number;
}

// README.md §1 기술 스택 — "UI 상태(선택 동, HUD)"만 Zustand에 둔다.
// 3,500개 동 배열 자체는 world/worldView.ts(React 밖, 서버 상태 사본)에 두고 요약만 끌어온다.
interface UIState {
  phase: "loading" | "ready" | "error";
  errorMessage: string | null;
  selectedIndex: number | null;
  selectedInfo: SelectedInfo | null;
  leaderboard: LeaderboardRow[];
  myRank: Rank;
  logEntries: LogEntry[];
  toast: string | null;

  setPhase: (phase: UIState["phase"], errorMessage?: string) => void;
  select: (index: number | null) => void;
  refreshSummary: () => void;
  showToast: (message: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUIStore = create<UIState>((set, get) => ({
  phase: "loading",
  errorMessage: null,
  selectedIndex: null,
  selectedInfo: null,
  leaderboard: [],
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

    set({
      selectedInfo,
      leaderboard: getLeaderboard(),
      myRank: computeRank(world.myHolderId),
      logEntries: world.logEntries,
    });
  },

  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },
}));
