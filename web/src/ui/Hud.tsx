import { useUIStore } from "../store/uiStore";
import { world } from "../world/worldView";
import { ENV_PALETTE_IDX, PALETTE } from "../config";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection | null; // GAME OVER 오버레이의 재시작 버튼이 sendRestart를 보내는 데 씀
}

export function Hud({ connection }: Props) {
  const phase = useUIStore((s) => s.phase);
  const errorMessage = useUIStore((s) => s.errorMessage);
  const selectedInfo = useUIStore((s) => s.selectedInfo);
  const leaderboard = useUIStore((s) => s.leaderboard);
  const myHolderId = useUIStore((s) => s.myHolderId);
  const envCells = useUIStore((s) => s.envCells);
  const myRank = useUIStore((s) => s.myRank);
  const logEntries = useUIStore((s) => s.logEntries);
  const toast = useUIStore((s) => s.toast);
  const sortieRatio = useUIStore((s) => s.sortieRatio);
  const setSortieRatio = useUIStore((s) => s.setSortieRatio);
  const missileCount = useUIStore((s) => s.missileCount);
  const isAiming = useUIStore((s) => s.isAiming);
  const setAiming = useUIStore((s) => s.setAiming);
  const rallyIndex = useUIStore((s) => s.rallyIndex);
  const isTransporting = useUIStore((s) => s.isTransporting);
  const setTransporting = useUIStore((s) => s.setTransporting);
  const airdropCooldownLeft = useUIStore((s) => s.airdropCooldownLeft);
  const airdropCoolSec = Math.ceil(airdropCooldownLeft / 1000);
  const defeated = useUIStore((s) => s.defeated);
  const setDefeated = useUIStore((s) => s.setDefeated);
  const connectionLost = useUIStore((s) => s.connectionLost);
  const setPhase = useUIStore((s) => s.setPhase);
  const sortiePct = Math.round(sortieRatio * 100);
  const rallyName = rallyIndex >= 0 && rallyIndex < world.n ? world.meta[rallyIndex].name : null;

  if (phase === "loading") {
    return (
      <div className="hud-overlay hud-center">
        <div className="loading-box">
          <div className="loading-spinner" />
          <p className="loading-title">전국 지도를 준비하는 중…</p>
          <p className="loading-sub">3,500개 행정동의 경계·인접 그래프를 계산하고 있어요</p>
        </div>
      </div>
    );
  }

  // 접속 화면(닉네임 입력) 표시 중에는 HUD를 감춘다 — JoinScreen이 화면을 덮는다.
  if (phase === "join") return null;

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
            <li key={row.holderId} className={row.holderId === myHolderId ? "me" : ""}>
              <span
                className="hud-swatch"
                style={{ background: PALETTE[row.paletteIdx]?.stroke }}
              />
              {row.name} — {row.count}개 동
            </li>
          ))}
        </ol>
        <div className="hud-env">
          {envCells > 0 ? (
            <>
              <span className="hud-swatch" style={{ background: PALETTE[ENV_PALETTE_IDX].stroke }} />{" "}
              야만인 잔존: {envCells}개 동
            </>
          ) : (
            <span className="hud-env-clear">야만인 정리됨 ✓</span>
          )}
        </div>
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
        <div className="hud-ratio-head">
          <span className="hud-title">출정 병력</span>
          <strong className="hud-ratio-value">{sortiePct}%</strong>
        </div>
        <input
          type="range"
          className="hud-ratio-slider"
          min={5}
          max={100}
          step={5}
          value={sortiePct}
          onChange={(e) => setSortieRatio(Number(e.currentTarget.value) / 100)}
          aria-label="출정 병력 비율"
        />
        <div className="hud-ratio-hint">우클릭 1회당 선택한 동 병력의 {sortiePct}%를 보냅니다</div>

        <div style={{ marginTop: 10, borderTop: "1px solid #ffffff22", paddingTop: 8 }}>
          <div className="hud-ratio-head">
            <span className="hud-title">미사일</span>
            <strong className="hud-ratio-value">{missileCount}발</strong>
          </div>
          <button
            type="button"
            disabled={missileCount === 0 && !isAiming}
            onClick={() => setAiming(!isAiming)}
            style={{
              width: "100%",
              marginTop: 4,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #ffffff55",
              background: isAiming ? "#c0392b" : missileCount === 0 ? "#2a3340" : "#3a4a5e",
              color: "#fff",
              cursor: missileCount === 0 && !isAiming ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {isAiming ? "조준 중… (Esc 취소)" : "미사일 발사 (Space)"}
          </button>
          <div className="hud-ratio-hint">
            {isAiming
              ? "지도에서 범위를 클릭해 발사 — 걸친 동이 중립이 됩니다"
              : "Space로 조준 · 범위에 걸친 동을 중립으로 만듭니다"}
          </div>
        </div>

        <div style={{ marginTop: 10, borderTop: "1px solid #ffffff22", paddingTop: 8 }}>
          <div className="hud-ratio-head">
            <span className="hud-title">집결지 (보급)</span>
            <strong className="hud-ratio-value" style={{ fontSize: 12 }}>
              {rallyName ?? "없음"}
            </strong>
          </div>
          <div className="hud-ratio-hint">
            내 동을 <strong>더블클릭</strong>해 집결지 지정 (같은 동 더블클릭 = 해제).
            <br />
            후방 병력이 집결지로 매 초 한 칸씩 자동 전진합니다.
          </div>
        </div>

        <div style={{ marginTop: 10, borderTop: "1px solid #ffffff22", paddingTop: 8 }}>
          <div className="hud-ratio-head">
            <span className="hud-title">공수부대 (병력 수송)</span>
            <strong className="hud-ratio-value" style={{ fontSize: 12 }}>
              {airdropCooldownLeft > 0 ? `${airdropCoolSec}초` : "준비"}
            </strong>
          </div>
          <button
            type="button"
            disabled={airdropCooldownLeft > 0 && !isTransporting}
            onClick={() => setTransporting(!isTransporting)}
            style={{
              width: "100%",
              marginTop: 4,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #ffffff55",
              background: isTransporting ? "#b8860b" : airdropCooldownLeft > 0 ? "#2a3340" : "#3a4a5e",
              color: "#fff",
              cursor: airdropCooldownLeft > 0 && !isTransporting ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {isTransporting
              ? "수송 중… (Esc 취소)"
              : airdropCooldownLeft > 0
                ? `재사용 대기 ${airdropCoolSec}초`
                : "병력 수송 (Shift)"}
          </button>
          <div className="hud-ratio-hint">
            {isTransporting
              ? "① 원으로 내 동 선택(클릭) → ② 목적지 클릭 (섬도 가능)"
              : "Shift로 조준 · 원으로 고른 내 동 병력을 목적지에 투하 — 넘치면 주변으로 점령"}
          </div>
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
              이동/출정: {Math.floor(selectedInfo.troops * sortieRatio)}명 ({sortiePct}%)
              <br />
              인접 동 우클릭 = 출정 · 먼 내 동 우클릭 = 자동 행군
            </div>
          )}
        </div>
      )}

      {connectionLost && (
        <div className="hud-conn-lost">
          <span className="hud-conn-dot" /> 연결 끊김 — 재연결 중…
        </div>
      )}

      {toast && <div className="hud-toast">{toast}</div>}

      {defeated && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(6,10,20,0.72)",
            zIndex: 100,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              background: "#141b28",
              border: "1px solid #ffffff22",
              borderRadius: 14,
              padding: "28px 34px",
              textAlign: "center",
              boxShadow: "0 12px 44px rgba(0,0,0,0.55)",
              minWidth: 280,
            }}
          >
            <div style={{ fontSize: 38, fontWeight: 900, letterSpacing: 3, color: "#ff5a5a" }}>
              GAME OVER
            </div>
            <p style={{ margin: "12px 0 22px", color: "#cdd6e4", fontSize: 14 }}>
              영토를 모두 잃었습니다.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => {
                  setDefeated(false);
                  setPhase("join");
                }}
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  border: "1px solid #ffffff33",
                  background: "#3a4a5e",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                메인 화면
              </button>
              <button
                type="button"
                onClick={() => {
                  connection?.sendRestart();
                  setDefeated(false);
                }}
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  border: "1px solid #ffffff33",
                  background: "#c0392b",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                재시작
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
