import { create } from "zustand";
import { world, computeRank, myMissileCount } from "../world/worldView";
import { CONFIG } from "../config";
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
  // 우클릭 1회당 이동할 병력 비율(0~1). 오른쪽 아래 슬라이더로 조절. (CONFIG.SORTIE_RATIO 기본)
  sortieRatio: number;
  missileCount: number; // 내 보유 미사일 수 (오른쪽 아래 표시)
  isAiming: boolean; // 미사일 조준 모드(발사 버튼 누른 상태)
  rallyIndex: number; // B2 — 내 집결지 admIndex(-1=없음)
  isSettingRally: boolean; // B2 — 집결지 지정 모드(지도 클릭으로 집결지 선택)

  setPhase: (phase: UIState["phase"], errorMessage?: string) => void;
  setSortieRatio: (ratio: number) => void;
  setAiming: (v: boolean) => void;
  setSettingRally: (v: boolean) => void;
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

// 계급 승급 토스트용 — 직전 계급 레벨. -1 = 아직 초기화 전(첫 계산은 토스트 안 함).
const RANK_LEVEL: Record<string, number> = { 동장: 1, 시장: 2, 도지사: 3 };
let prevRankLevel = -1;

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
  sortieRatio: CONFIG.SORTIE_RATIO,
  missileCount: 0,
  isAiming: false,
  rallyIndex: -1,
  isSettingRally: false,

  setPhase: (phase, errorMessage) => set({ phase, errorMessage: errorMessage ?? null }),
  setSortieRatio: (ratio) => set({ sortieRatio: Math.min(1, Math.max(0.05, ratio)) }),
  setAiming: (v) => set({ isAiming: v }),
  setSettingRally: (v) => set({ isSettingRally: v }),

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
    const myRank = computeRank(world.myHolderId);
    set({
      selectedInfo,
      myHolderId: world.myHolderId,
      myRank,
      missileCount: myMissileCount(),
      rallyIndex: world.myRally,
      logEntries: world.logEntries,
    });

    // 계급 승급 토스트 (첫 계산과 강등은 제외).
    const lvl = myRank ? RANK_LEVEL[myRank] : 0;
    if (prevRankLevel >= 0 && lvl > prevRankLevel && myRank) {
      get().showToast(`${myRank} 승급! 🎉`);
    }
    prevRankLevel = lvl;
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
