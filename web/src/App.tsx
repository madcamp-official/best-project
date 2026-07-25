import { useEffect, useRef, useState } from "react";
import "./App.css";
import { MapView } from "./map/MapView";
import { Hud } from "./ui/Hud";
import { JoinScreen } from "./ui/JoinScreen";
import { loadDong } from "./data/loadDong";
import type { PreparedMap } from "./data/loadDong";
import { LocalConnection } from "./net/localConnection";
import type { Connection } from "./net/connection";
import { applyWelcome, applyDelta, getLeaderboard, envCellCount, world } from "./world/worldView";
import { useUIStore } from "./store/uiStore";

// plan.md §3 — 클라는 렌더러 + 입력 전송기.
// 데이터 로드 → Connection(지금은 브라우저 내 로컬 mock 서버) 생성 → 접속 화면(닉네임) →
// JOIN → WELCOME 스냅샷 반영 → 이후 DELTA로만 갱신.
function App() {
  const [prepared, setPrepared] = useState<PreparedMap | null>(null);
  const connectionRef = useRef<Connection | null>(null);
  const phase = useUIStore((s) => s.phase);
  const setPhase = useUIStore((s) => s.setPhase);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await loadDong();
        if (cancelled) return;

        // 목 서버 생성 + 서버→클라 메시지 배선.
        const connection = new LocalConnection(map);
        connection.onWelcome((msg) => {
          applyWelcome(msg);
          localStorage.setItem("token", msg.token); // 재접속용
          // 첫 LEADERBOARD 메시지(최대 1s 뒤) 전 빈 순위표 깜빡임 방지용 시드.
          useUIStore.getState().setLeaderboard(getLeaderboard(), envCellCount(), world.n);
          setPrepared(map); // 스냅샷 반영 후 지도 렌더 시작
          setPhase("ready");
        });
        connection.onDelta((msg) => applyDelta(msg));
        connection.onError((msg) => useUIStore.getState().showToast(msg.message));
        connection.onLeaderboard((msg) =>
          useUIStore.getState().setLeaderboard(msg.rows, msg.envCells, msg.totalCells)
        );
        connectionRef.current = connection;

        // 데이터 준비 완료 → 접속 화면(닉네임 입력)으로.
        setPhase("join");
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
  }, [setPhase]);

  const handleJoin = (nickname: string) => {
    const token = localStorage.getItem("token") ?? undefined;
    connectionRef.current?.join(nickname, token);
  };

  return (
    <div className="app-root">
      {prepared && connectionRef.current && (
        <MapView prepared={prepared} connection={connectionRef.current} />
      )}
      <Hud />
      {phase === "join" && <JoinScreen onJoin={handleJoin} />}
    </div>
  );
}

export default App;
