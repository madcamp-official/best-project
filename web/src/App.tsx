import { useEffect, useRef, useState } from "react";
import "./App.css";
import { MapView } from "./map/MapView";
import { Hud } from "./ui/Hud";
import { JoinScreen } from "./ui/JoinScreen";
import { LobbyScreen } from "./ui/LobbyScreen";
import { RoomWaitScreen } from "./ui/RoomWaitScreen";
import { ResultsOverlay } from "./ui/ResultsOverlay";
import { loadMapData, DEFAULT_MAP_ID } from "./data/loadMapData";
import type { PreparedMap } from "./data/loadMapData";
import { LocalConnection } from "./net/localConnection";
import { StompConnection } from "./net/stompConnection";
import type { Connection } from "./net/connection";
import {
  applyWelcome,
  applyDelta,
  getLeaderboard,
  envCellCount,
  drainDefeat,
  drainVictory,
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
  // 방마다 지도(mapId)가 다를 수 있어(로비에서 선택) WELCOME을 받고서야 어느 지도를 로드할지
  // 안다 — 지도별로 한 번만 로드해 재사용하는 캐시(같은 지도로 재입장 시 재요청 방지).
  const mapCacheRef = useRef<Map<string, PreparedMap>>(new Map());
  const phase = useUIStore((s) => s.phase);
  const setPhase = useUIStore((s) => s.setPhase);
  // 목업(브라우저 내 목 서버)은 로비가 없어 join()으로 솔로 진행, 실서버는 로비 흐름.
  const isMock = import.meta.env.VITE_USE_LOCAL_MOCK === "1";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 목업은 로비가 없어 기본 지도를 즉시 로드해 목 서버 생성에 써야 한다. 실서버는 방에
        // 입장(WELCOME 수신)해야 어느 지도인지 알 수 있으므로 여기서는 로드하지 않는다.
        let connection: Connection;
        if (isMock) {
          const map = await loadMapData(DEFAULT_MAP_ID);
          if (cancelled) return;
          mapCacheRef.current.set(DEFAULT_MAP_ID, map);
          connection = new LocalConnection(map);
        } else {
          connection = new StompConnection();
        }

        // 서버→클라 메시지 배선.
        connection.onWelcome(async (msg) => {
          let map = mapCacheRef.current.get(msg.mapId);
          if (!map) {
            map = await loadMapData(msg.mapId);
            if (cancelled) return;
            mapCacheRef.current.set(msg.mapId, map);
          }
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
          // 대통령(40%) 우승 오버레이는 라운드가 없는 목업 솔로에서만 — 실서버 라운드는 서버 RoundEnd가
          // 우승(51% 도미네이션/30분)을 판정하므로, 40%에서 오버레이가 조기 발동하지 않게 목업으로 제한한다.
          // (계급 표시상의 "대통령"은 그대로 유지 — computeRank가 담당.) drainVictory는 항상 호출해 플래그를 비운다.
          if (drainVictory() && isMock) useUIStore.getState().setVictorious(true);
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
          st.setIsRoomHost(msg.youAreHost); // 입장 응답이자 방장 승계 통지(방장이 나가면 재전송됨)
          if (st.phase === "lobby") st.setMyReady(false); // 새 입장 — 준비 초기화(승계 통지 땐 유지)
          // 진행 중 방 난입은 곧 WELCOME이 ready로 바꾸고, 결과/게임 화면 중 승계 통지로 화면을 끌어내리지 않는다.
          if (msg.state !== "PLAYING" && (st.phase === "lobby" || st.phase === "room")) setPhase("room");
        });
        connection.onRoomState((msg) => {
          const st = useUIStore.getState();
          st.setMembers(msg.members);
          if (st.currentRoom && st.currentRoom.roomId === msg.roomId) {
            st.setCurrentRoom({ ...st.currentRoom, state: msg.state });
          }
        });
        connection.onRoundEnd((msg) => {
          const st = useUIStore.getState();
          st.setRoundResult(msg);
          st.setMyReady(false); // 서버가 라운드 종료 시 전원 준비를 리셋 — 로컬 상태도 맞춘다
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
