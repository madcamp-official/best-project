import { useEffect, useState } from "react";
import "./App.css";
import { MapView } from "./map/MapView";
import { Hud } from "./ui/Hud";
import { loadDong } from "./data/loadDong";
import type { PreparedMap } from "./data/loadDong";
import { initGame, pickStartIndex } from "./game/state";
import { useUIStore } from "./store/uiStore";

// README.md §9 마일스톤 1~2 — 서버 없는 오프라인 목업.
// 데이터 로드 → 인접 그래프 계산 → 게임 상태 초기화까지 여기서 1회 수행.
function App() {
  const [prepared, setPrepared] = useState<PreparedMap | null>(null);
  const setPhase = useUIStore((s) => s.setPhase);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await loadDong();
        if (cancelled) return;
        const startIndex = pickStartIndex(map.meta);
        initGame(map.n, map.neighborIndex, map.meta, startIndex);
        setPrepared(map);
      } catch (err) {
        if (cancelled) return;
        setPhase("error", err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setPhase]);

  return (
    <div className="app-root">
      {prepared && <MapView prepared={prepared} />}
      <Hud />
    </div>
  );
}

export default App;
