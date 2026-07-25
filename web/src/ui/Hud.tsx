import { useUIStore } from "../store/uiStore";
import { CONFIG, MY_HOLDER_ID, PALETTE } from "../config";

export function Hud() {
  const phase = useUIStore((s) => s.phase);
  const errorMessage = useUIStore((s) => s.errorMessage);
  const selectedInfo = useUIStore((s) => s.selectedInfo);
  const leaderboard = useUIStore((s) => s.leaderboard);
  const myRank = useUIStore((s) => s.myRank);
  const logEntries = useUIStore((s) => s.logEntries);
  const toast = useUIStore((s) => s.toast);

  if (phase === "loading") {
    return (
      <div className="hud-overlay hud-center">
        <p>서울 행정동 지도를 불러오는 중...</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="hud-overlay hud-center">
        <p className="hud-error">지도를 불러오지 못했습니다.</p>
        {errorMessage && <p className="hud-error-detail">{errorMessage}</p>}
      </div>
    );
  }

  return (
    <div className="hud-overlay">
      <div className="hud-panel hud-top-left">
        <div className="hud-title">영토 점령 게임 · 목업</div>
        <div className="hud-rank">
          내 계급: <strong>{myRank ?? "무소속"}</strong>
        </div>
        <ol className="hud-leaderboard">
          {leaderboard.map((row) => (
            <li key={row.holderId} className={row.holderId === MY_HOLDER_ID ? "me" : ""}>
              <span
                className="hud-swatch"
                style={{ background: PALETTE[row.holderId % PALETTE.length]?.stroke }}
              />
              {row.name} — {row.count}개 동
            </li>
          ))}
        </ol>
      </div>

      <div className="hud-panel hud-bottom-left">
        <div className="hud-title">최근 기록</div>
        <ul className="hud-log">
          {logEntries.length === 0 && <li className="hud-log-empty">아직 기록이 없습니다.</li>}
          {logEntries.map((entry) => (
            <li key={entry.id}>{entry.message}</li>
          ))}
        </ul>
      </div>

      <div className="hud-panel hud-bottom-right">
        <div className="hud-title">범례</div>
        <div className="hud-legend-row">
          <span className="hud-swatch" style={{ background: PALETTE[0].stroke }} /> 중립 (병력 {CONFIG.NEUTRAL_TROOPS})
        </div>
        <div className="hud-legend-row">
          <span className="hud-swatch" style={{ background: PALETTE[1].stroke }} /> 나
        </div>
      </div>

      {selectedInfo && (
        <div className="hud-panel hud-top-right">
          <div className="hud-title">{selectedInfo.name}</div>
          <div>소유자: {selectedInfo.ownerName}</div>
          <div>
            병력: {selectedInfo.troops} / {selectedInfo.cap}
          </div>
          {selectedInfo.isMine && (
            <div className="hud-sortie">
              이동/출정: {Math.floor(selectedInfo.troops * CONFIG.SORTIE_RATIO)}명 (인접 동 우클릭)
            </div>
          )}
        </div>
      )}

      {toast && <div className="hud-toast">{toast}</div>}
    </div>
  );
}
