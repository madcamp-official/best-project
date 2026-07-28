import { create } from "zustand";
import { world, computeRank, myMissileCount, myNukeStatus } from "../world/worldView";
import type { LogEntry, Rank } from "../game/types";
import type { MemberInfo, RoomInfo, RoomState, RoundEndMessage } from "../net/protocol";

// 현재 참가 중인 방 요약(대기실/결과 화면 표시용).
export interface CurrentRoom {
  roomId: string;
  name: string;
  state: RoomState;
}

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
  // loading→(mock)join / (real)lobby→room→ready→results. error는 로드 실패.
  phase: "loading" | "join" | "lobby" | "room" | "ready" | "results" | "error";
  errorMessage: string | null;
  // 로비/방(다중 세션)
  rooms: RoomInfo[]; // 공개 방 목록(/topic/rooms)
  currentRoom: CurrentRoom | null; // 지금 참가 중인 방
  members: MemberInfo[]; // 현재 방의 멤버 목록
  isRoomHost: boolean; // 내가 이 방의 방장인가(시작 권한). roomJoined의 youAreHost로 갱신(승계 포함)
  myReady: boolean; // 내 준비 상태(방장 아닐 때, 낙관적 로컬 토글 — 서버 브로드캐스트가 최종 진실)
  roundResult: RoundEndMessage | null; // 방금 끝난 라운드 결과(결과 화면용)
  roundEndsAt: number; // 라운드 종료 로컬 시각(Date.now ms). 0=제한 없음 — HUD 타이머 표시용
  selectedIndex: number | null;
  selectedInfo: SelectedInfo | null;
  leaderboard: LeaderboardRowUI[];
  envCells: number; // 환경 세력(E) 잔존 동 수 (README §8)
  totalCells: number;
  myHolderId: number;
  myRank: Rank;
  logEntries: LogEntry[];
  toast: string | null;
  missileCount: number; // 내 보유 미사일 수 (오른쪽 아래 표시)
  isAiming: boolean; // 미사일 조준 모드(발사 버튼 누른 상태)
  isNukeAiming: boolean; // 전술핵 조준 모드(사일로 보유자 전용, 반경 3배)
  nukeOwned: boolean; // 전술핵 사일로(울릉도·제주) 보유 여부
  nukeCooldownLeft: number; // 전술핵 남은 재장전(ms). refreshSummary가 갱신
  rallyIndex: number; // B2 — 내 집결지 admIndex(-1=없음). 지정은 지도 더블클릭으로.
  attackQueueCount: number; // 내 공격 큐에 담긴 대상 수. 지정은 적·중립 지역 우클릭으로.
  isTransporting: boolean; // B3 — 공수(병력 수송) 모드
  airdropReadyAt: number; // B3 — 공수 재사용 가능 시각(Date.now ms). 0=준비됨
  airdropCooldownLeft: number; // B3 — 남은 쿨타임(ms). refreshSummary가 갱신(버튼 표시용)
  defeated: boolean; // 내 영토를 전부 잃어 패배 오버레이를 표시 중
  victorious: boolean; // 점유율 40%를 넘어 대통령 당선(우승) 오버레이를 표시 중
  connectionLost: boolean; // 실서버 연결이 끊겨 재연결 중(끊김 배너 표시)

  setPhase: (phase: UIState["phase"], errorMessage?: string) => void;
  setRooms: (rooms: RoomInfo[]) => void;
  setCurrentRoom: (room: CurrentRoom | null) => void;
  setMembers: (members: MemberInfo[]) => void;
  setIsRoomHost: (v: boolean) => void;
  setMyReady: (v: boolean) => void;
  setRoundResult: (r: RoundEndMessage | null) => void;
  setRoundEndsAt: (t: number) => void;
  setAiming: (v: boolean) => void;
  setNukeAiming: (v: boolean) => void;
  setTransporting: (v: boolean) => void;
  startAirdropCooldown: (ms: number) => void;
  setDefeated: (v: boolean) => void;
  setVictorious: (v: boolean) => void;
  setConnectionLost: (v: boolean) => void;
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
const RANK_LEVEL: Record<string, number> = { 동장: 1, 시장: 2, 도지사: 3, 대통령: 4 };
let prevRankLevel = -1;

export const useUIStore = create<UIState>((set, get) => ({
  phase: "loading",
  errorMessage: null,
  rooms: [],
  currentRoom: null,
  members: [],
  isRoomHost: false,
  myReady: false,
  roundResult: null,
  roundEndsAt: 0,
  selectedIndex: null,
  selectedInfo: null,
  leaderboard: [],
  envCells: 0,
  totalCells: 0,
  myHolderId: 0,
  myRank: null,
  logEntries: [],
  toast: null,
  missileCount: 0,
  isAiming: false,
  isNukeAiming: false,
  nukeOwned: false,
  nukeCooldownLeft: 0,
  rallyIndex: -1,
  attackQueueCount: 0,
  isTransporting: false,
  airdropReadyAt: 0,
  airdropCooldownLeft: 0,
  defeated: false,
  victorious: false,
  connectionLost: false,

  setPhase: (phase, errorMessage) => set({ phase, errorMessage: errorMessage ?? null }),
  setRooms: (rooms) => set({ rooms }),
  setCurrentRoom: (currentRoom) => set({ currentRoom }),
  setMembers: (members) => set({ members }),
  setIsRoomHost: (isRoomHost) => set({ isRoomHost }),
  setMyReady: (myReady) => set({ myReady }),
  setRoundResult: (roundResult) => set({ roundResult }),
  setRoundEndsAt: (roundEndsAt) => set({ roundEndsAt }),
  // 미사일·전술핵 조준·공수 모드는 상호 배타 — 하나를 켜면 나머지는 끈다.
  setAiming: (v) =>
    set(v ? { isAiming: true, isNukeAiming: false, isTransporting: false } : { isAiming: false }),
  setNukeAiming: (v) =>
    set(v ? { isNukeAiming: true, isAiming: false, isTransporting: false } : { isNukeAiming: false }),
  setTransporting: (v) =>
    set(v ? { isTransporting: true, isAiming: false, isNukeAiming: false } : { isTransporting: false }),
  startAirdropCooldown: (ms) => set({ airdropReadyAt: Date.now() + ms }),
  setDefeated: (v) => set({ defeated: v }),
  setVictorious: (v) => set({ victorious: v }),
  setConnectionLost: (v) => set({ connectionLost: v }),

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
    const nuke = myNukeStatus();
    set({
      selectedInfo,
      myHolderId: world.myHolderId,
      myRank,
      missileCount: myMissileCount(),
      nukeOwned: nuke.owned,
      nukeCooldownLeft: nuke.cooldownLeftMs,
      rallyIndex: world.myRally,
      attackQueueCount: world.myAttackQueue.size,
      airdropCooldownLeft: Math.max(0, get().airdropReadyAt - Date.now()),
      logEntries: world.logEntries,
    });

    // 계급 승급 토스트 (첫 계산과 강등은 제외). 대통령 승급은 별도의 우승 오버레이가 담당하므로 중복 표시하지 않는다.
    const lvl = myRank ? RANK_LEVEL[myRank] : 0;
    if (prevRankLevel >= 0 && lvl > prevRankLevel && myRank && myRank !== "대통령") {
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
