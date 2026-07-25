import { create } from "zustand";
import { MY_HOLDER_ID } from "../config";
import { game, getLeaderboard, computeRank } from "../game/state";
import type { LeaderboardRow } from "../game/state";
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
// 3,500개 동 배열 자체는 game/state.ts(React 밖)에 그대로 둔 채, 요약만 여기로 끌어온다.
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
      selectedIndex === null
        ? null
        : {
            index: selectedIndex,
            name: game.meta[selectedIndex].name,
            ownerName: game.holders.get(game.ownerId[selectedIndex])?.name ?? "?",
            isMine: game.ownerId[selectedIndex] === MY_HOLDER_ID,
            troops: game.troops[selectedIndex],
            cap: game.troopCap[selectedIndex],
          };

    set({
      selectedInfo,
      leaderboard: getLeaderboard(),
      myRank: computeRank(MY_HOLDER_ID),
      logEntries: game.logEntries,
    });
  },

  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },
}));
