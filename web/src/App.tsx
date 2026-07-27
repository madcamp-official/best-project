import { useEffect, useRef, useState } from "react";
import "./App.css";
import { MapView } from "./map/MapView";
import { Hud } from "./ui/Hud";
import { JoinScreen } from "./ui/JoinScreen";
import { LobbyScreen } from "./ui/LobbyScreen";
import { RoomWaitScreen } from "./ui/RoomWaitScreen";
import { ResultsOverlay } from "./ui/ResultsOverlay";
import { loadDong } from "./data/loadDong";
import type { PreparedMap } from "./data/loadDong";
import { LocalConnection } from "./net/localConnection";
import { StompConnection } from "./net/stompConnection";
import type { Connection } from "./net/connection";
import {
  applyWelcome,
  applyDelta,
  getLeaderboard,
  envCellCount,
  drainDefeat,
  world,
} from "./world/worldView";
import { useUIStore } from "./store/uiStore";

// plan.md §3 — 클라는 렌더러 + 입력 전송기.
// 데이터 로드 → Connection(기본: 실서버 StompConnection) 생성 → 접속 화면(닉네임) →
// JOIN → WELCOME 스냅샷 반영 → 이후 DELTA로만 갱신.
//
// 서버 없이 렌더링/입력만 확인하고 싶을 때는 `VITE_USE_LOCAL_MOCK=1 npm run dev`로
// 브라우저 내 목 서버(localConnection)를 대신 쓸 수 있다 — Connection 계약이 같아
// 이 스위치 하나로 교체된다(architecture.md §2.3).
function App() {
  const [prepared, setPrepared] = useState<PreparedMap | null>(null);
  const connectionRef = useRef<Connection | null>(null);
  const everConnectedRef = useRef(false); // 재연결 토스트를 최초 연결 때는 안 띄우기 위한 플래그
  const phase = useUIStore((s) => s.phase);
  const setPhase = useUIStore((s) => s.setPhase);
  // 목업(브라우저 내 목 서버)은 로비가 없어 join()으로 솔로 진행, 실서버는 로비 흐름.
  const isMock = import.meta.env.VITE_USE_LOCAL_MOCK === "1";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await loadDong();
        if (cancelled) return;

        // Connection 생성(기본: 실서버 STOMP) + 서버→클라 메시지 배선.
        const connection: Connection = isMock ? new LocalConnection(map) : new StompConnection();
        connection.onWelcome((msg) => {
          applyWelcome(msg);
          localStorage.setItem("token", msg.token); // 재접속용
          const st = useUIStore.getState();
          // 첫 LEADERBOARD 메시지(최대 1s 뒤) 전 빈 순위표 깜빡임 방지용 시드.
          st.setLeaderboard(getLeaderboard(), envCellCount(), world.n);
          // 새 라운드 진입 — 지난 라운드의 잔여 UI 상태(결과·패배 오버레이·조준/수송 모드)를 전부 정리.
          // 안 하면 지난 라운드에서 패배한 채 새 라운드를 시작할 때 GAME OVER가 즉시 다시 뜬다.
          st.setRoundResult(null);
          st.setDefeated(false);
          st.setAiming(false);
          st.setTransporting(false);
          // 라운드 타이머: 서버 시각(roundEndsAtMs - serverTimeMs = 남은 시간)을 로컬 시계로 환산.
          st.setRoundEndsAt(msg.roundEndsAtMs > 0 ? Date.now() + (msg.roundEndsAtMs - msg.serverTimeMs) : 0);
          setPrepared(map); // 스냅샷 반영 후 지도 렌더 시작
          setPhase("ready"); // WELCOME = 라운드 진행 중 → 지도로 전환
        });
        connection.onDelta((msg) => {
          applyDelta(msg);
          // 내 영토가 이번 delta에 전부 사라지면(미사일·점령) GAME OVER 오버레이를 띄운다.
          // 재시작은 유저가 오버레이 버튼으로 직접 선택한다(더 이상 자동 재배정 없음).
          if (drainDefeat()) useUIStore.getState().setDefeated(true);
        });
        connection.onError((msg) => {
          useUIStore.getState().showToast(msg.message);
          // 입장하려던 방이 사라진 경우(마지막 멤버 이탈로 폐기 등)엔 로비로 돌려보낸다.
          if (msg.code === "ROOM_NOT_FOUND") {
            useUIStore.getState().setCurrentRoom(null);
            setPhase("lobby");
            connection.listRooms();
          }
        });
        connection.onLeaderboard((msg) =>
          useUIStore.getState().setLeaderboard(msg.rows, msg.envCells, msg.totalCells)
        );
        // 로비/방(다중 세션) 이벤트 배선.
        connection.onRoomList((msg) => useUIStore.getState().setRooms(msg.rooms));
        connection.onRoomJoined((msg) => {
          const st = useUIStore.getState();
          st.setCurrentRoom({ roomId: msg.roomId, name: msg.name, state: msg.state });
          st.setMembers(msg.members);
          // 진행 중 방에 난입한 경우엔 곧 WELCOME이 와서 ready로 바꾸므로 여기선 대기실로 내리지 않는다.
          if (msg.state !== "PLAYING") setPhase("room");
        });
        connection.onRoomState((msg) => {
          const st = useUIStore.getState();
          st.setMembers(msg.members);
          if (st.currentRoom && st.currentRoom.roomId === msg.roomId) {
            st.setCurrentRoom({ ...st.currentRoom, state: msg.state });
          }
        });
        connection.onRoundEnd((msg) => {
          useUIStore.getState().setRoundResult(msg);
          setPhase("results");
        });
        // 연결 끊김 → 배너 표시, 재연결 → 배너 해제(+최초 연결이 아니면 재연결 토스트).
        connection.onConnectionChange((connected) => {
          useUIStore.getState().setConnectionLost(!connected);
          if (connected) {
            if (everConnectedRef.current) useUIStore.getState().showToast("서버에 재연결되었습니다");
            everConnectedRef.current = true;
          }
        });
        connectionRef.current = connection;

        // 데이터 준비 완료 → 목업이면 닉네임 접속 화면, 실서버면 로비로.
        if (isMock) {
          setPhase("join");
        } else {
          setPhase("lobby");
          connection.listRooms();
        }
      } catch (err) {
        if (cancelled) return;
        setPhase("error", err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      connectionRef.current?.dispose();
      connectionRef.current = null;
    };
  }, [setPhase, isMock]);

  const handleJoin = (nickname: string) => {
    const token = localStorage.getItem("token") ?? undefined;
    connectionRef.current?.join(nickname, token);
    // 첫 참가자에게만 조작 안내 (한 번 보면 다시 안 뜸).
    if (!localStorage.getItem("onboarded")) {
      localStorage.setItem("onboarded", "1");
      setTimeout(
        () =>
          useUIStore
            .getState()
            .showToast("좌클릭으로 내 동 선택 → 우클릭으로 출정! 야만인을 물리치고 영토를 넓히세요"),
        900
      );
    }
  };

  return (
    <div className="app-root">
      {prepared && connectionRef.current && (
        <MapView prepared={prepared} connection={connectionRef.current} />
      )}
      <Hud connection={connectionRef.current} isMock={isMock} />
      {phase === "join" && <JoinScreen onJoin={handleJoin} />}
      {phase === "lobby" && connectionRef.current && <LobbyScreen connection={connectionRef.current} />}
      {phase === "room" && connectionRef.current && <RoomWaitScreen connection={connectionRef.current} />}
      {phase === "results" && connectionRef.current && <ResultsOverlay connection={connectionRef.current} />}
    </div>
  );
}

export default App;
