import { useEffect, useRef, useState } from "react";
import "./App.css";
import { MapView } from "./map/MapView";
import { Hud } from "./ui/Hud";
import { loadDong } from "./data/loadDong";
import type { PreparedMap } from "./data/loadDong";
import { LocalConnection } from "./net/localConnection";
import type { Connection } from "./net/connection";
import { applyWelcome, applyDelta } from "./world/worldView";
import { useUIStore } from "./store/uiStore";

// plan.md §3 — 클라는 렌더러 + 입력 전송기. 데이터 로드 → Connection(지금은 브라우저 내
// 로컬 mock 서버) 생성 → JOIN → WELCOME 스냅샷 반영 → 이후 DELTA로만 갱신.
function App() {
  const [prepared, setPrepared] = useState<PreparedMap | null>(null);
  const connectionRef = useRef<Connection | null>(null);
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
          setPrepared(map); // 스냅샷 반영 후 지도 렌더 시작
        });
        connection.onDelta((msg) => applyDelta(msg));
        connection.onError((msg) => useUIStore.getState().showToast(msg.message));
        connectionRef.current = connection;

        // Day 1c에서 접속 화면으로 대체. 지금은 기본 닉네임으로 자동 접속.
        connection.join("나");
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

  return (
    <div className="app-root">
      {prepared && connectionRef.current && (
        <MapView prepared={prepared} connection={connectionRef.current} />
      )}
      <Hud />
    </div>
  );
}

export default App;
