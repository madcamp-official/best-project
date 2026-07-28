import { useEffect, useState } from "react";
import { useUIStore } from "../store/uiStore";
import { world } from "../world/worldView";
import { CONFIG, ENV_PALETTE_IDX, PALETTE } from "../config";
import { SGG_SPECIALTY } from "../data/sggSpecialty";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection | null; // GAME OVER 오버레이의 재시작/나가기 버튼이 명령을 보내는 데 씀
  isMock: boolean; // 목업이면 "메인 화면"이 로비가 아니라 닉네임 접속 화면(join)으로 간다
}

export function Hud({ connection, isMock }: Props) {
  const phase = useUIStore((s) => s.phase);
  const errorMessage = useUIStore((s) => s.errorMessage);
  const selectedInfo = useUIStore((s) => s.selectedInfo);
  const leaderboard = useUIStore((s) => s.leaderboard);
  const myHolderId = useUIStore((s) => s.myHolderId);
  const envCells = useUIStore((s) => s.envCells);
  const myRank = useUIStore((s) => s.myRank);
  const logEntries = useUIStore((s) => s.logEntries);
  const toast = useUIStore((s) => s.toast);
  const missileCount = useUIStore((s) => s.missileCount);
  const isAiming = useUIStore((s) => s.isAiming);
  const setAiming = useUIStore((s) => s.setAiming);
  const isNukeAiming = useUIStore((s) => s.isNukeAiming);
  const setNukeAiming = useUIStore((s) => s.setNukeAiming);
  const nukeOwned = useUIStore((s) => s.nukeOwned);
  const nukeCooldownLeft = useUIStore((s) => s.nukeCooldownLeft);
  const nukeCoolSec = Math.ceil(nukeCooldownLeft / 1000);
  const rallyIndex = useUIStore((s) => s.rallyIndex);
  const attackQueueCount = useUIStore((s) => s.attackQueueCount);
  const isTransporting = useUIStore((s) => s.isTransporting);
  const setTransporting = useUIStore((s) => s.setTransporting);
  const airdropCooldownLeft = useUIStore((s) => s.airdropCooldownLeft);
  const airdropCoolSec = Math.ceil(airdropCooldownLeft / 1000);
  const defeated = useUIStore((s) => s.defeated);
  const setDefeated = useUIStore((s) => s.setDefeated);
  const victorious = useUIStore((s) => s.victorious);
  const setVictorious = useUIStore((s) => s.setVictorious);
  const connectionLost = useUIStore((s) => s.connectionLost);
  const setPhase = useUIStore((s) => s.setPhase);
  const currentRoom = useUIStore((s) => s.currentRoom);
  const roundEndsAt = useUIStore((s) => s.roundEndsAt);
  const totalCells = useUIStore((s) => s.totalCells);
  const rallyName = rallyIndex >= 0 && rallyIndex < world.n ? world.meta[rallyIndex].name : null;

  // 방어막 카운트다운 — world.shieldUntil은 rAF 루프가 아니라 여기서 직접 읽으므로,
  // 표시를 갱신하려면 0.5초마다 리렌더를 스스로 트리거해야 한다(전투 로직과는 무관, 표시 전용).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const shieldSecLeft = Math.max(0, Math.ceil((world.shieldUntil[myHolderId] - nowTick) / 1000));

  // 라운드 남은 시간(ms). roundEndsAt=0이면 제한 없음(브리지/목업) — 타이머 미표시.
  const remainMs = roundEndsAt > 0 ? Math.max(0, roundEndsAt - nowTick) : -1;
  const timerMin = Math.floor(remainMs / 60000);
  const timerSec = Math.floor(remainMs / 1000) % 60;

  if (phase === "loading") {
    return (
      <div className="hud-overlay hud-center">
        <div className="loading-box">
          <div className="loading-spinner" />
          <p className="loading-title">전국 지도를 준비하는 중…</p>
          <p className="loading-sub">5,000여 개 법정동의 경계·인접 그래프를 계산하고 있어요</p>
        </div>
      </div>
    );
  }

  // 접속/로비/대기실/결과 화면 중에는 게임 HUD를 감춘다 — 각 화면 오버레이가 덮는다.
  if (phase === "join" || phase === "lobby" || phase === "room" || phase === "results") return null;

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
      {/* 상단 중앙: 라운드 타이머 pill (io 스타일). 남은 1분부터 빨갛게 깜빡인다. */}
      {remainMs >= 0 && (
        <div className={`hud-timer ${remainMs < 60_000 ? "urgent" : ""}`}>
          ⏱ {timerMin}:{String(timerSec).padStart(2, "0")}
        </div>
      )}

      {/* 좌상단: 내 정보 + 선택한 동 정보(세로 스택) */}
      <div className="hud-col hud-col-left">
        <div className="hud-panel">
          <div className="hud-title">{currentRoom?.name ?? "동대장 시뮬레이터"}</div>
          <div className="hud-rank">
            내 계급: <strong>{myRank ?? "무소속"}</strong>
          </div>
          {shieldSecLeft > 0 && (
            <div
              style={{
                margin: "4px 0",
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(111,214,255,0.15)",
                border: "1px solid rgba(211,244,255,0.5)",
                color: "#d3f4ff",
                fontSize: 13,
                fontWeight: 700,
                display: "inline-block",
              }}
            >
              🛡 방어막 {shieldSecLeft}초 — 이 시간 동안 공격받지 않습니다
            </div>
          )}
        </div>
        {selectedInfo && (
          <div className="hud-panel">
            <div className="hud-title">{selectedInfo.name}</div>
            {world.mapId === "kr-sgg" &&
              (() => {
                const code = world.meta[selectedInfo.index]?.code;
                const specialty = code ? SGG_SPECIALTY[code] : undefined;
                return specialty ? <div>🏷 특산물: {specialty}</div> : null;
              })()}
            <div>소유자: {selectedInfo.ownerName}</div>
            <div>
              병력: {selectedInfo.troops} / {selectedInfo.cap}
            </div>
            {selectedInfo.isMine && (
              <div className="hud-sortie">
                내 동 · <strong>더블클릭</strong>으로 집결지 지정
              </div>
            )}
          </div>
        )}
      </div>

      {/* 우상단: 점유율 바 순위표 (io 게임 표준 위치) */}
      <div className="hud-col hud-col-right">
        <div className="hud-panel">
          <div className="hud-title">순위</div>
          {leaderboard.slice(0, 8).map((row, i) => {
            const pct = totalCells > 0 ? (row.count / totalCells) * 100 : 0;
            const color = PALETTE[row.paletteIdx]?.stroke;
            return (
              <div className="hud-lb-row" key={row.holderId}>
                <div className={`hud-lb-line ${row.holderId === myHolderId ? "me" : ""}`}>
                  <span className="hud-swatch" style={{ background: color }} />
                  <span className="hud-lb-name">
                    {i + 1}. {row.name}
                  </span>
                  <span className="hud-lb-pct">{pct.toFixed(1)}%</span>
                </div>
                <div className="hud-lb-bar">
                  <div
                    className="hud-lb-fill"
                    style={{ width: `${Math.max(pct, 1)}%`, background: color }}
                  />
                </div>
              </div>
            );
          })}
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
        {/* 액션 버튼 두 칸 — 미사일 · 공수 (즉시 쓰는 능동 기술) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div className="hud-ratio-head">
              <span className="hud-title">미사일 🚀</span>
              <strong className="hud-ratio-value">{missileCount}발</strong>
            </div>
            <button
              type="button"
              className={`io-btn io-btn-sm io-btn-block ${isAiming ? "io-btn-amber" : "io-btn-primary"}`}
              style={{ marginTop: 6 }}
              disabled={missileCount === 0 && !isAiming}
              onClick={() => setAiming(!isAiming)}
            >
              {isAiming ? "조준 중 (Esc)" : "발사 (Space)"}
            </button>
          </div>
          <div>
            <div className="hud-ratio-head">
              <span className="hud-title">공수 🪂</span>
              <strong className="hud-ratio-value" style={{ fontSize: 12 }}>
                {airdropCooldownLeft > 0 ? `${airdropCoolSec}초` : "준비"}
              </strong>
            </div>
            <button
              type="button"
              className={`io-btn io-btn-sm io-btn-block ${isTransporting ? "io-btn-amber" : "io-btn-primary"}`}
              style={{ marginTop: 6 }}
              disabled={airdropCooldownLeft > 0 && !isTransporting}
              onClick={() => setTransporting(!isTransporting)}
            >
              {isTransporting ? "수송 중 (Esc)" : airdropCooldownLeft > 0 ? `대기 ${airdropCoolSec}초` : "수송 (Shift)"}
            </button>
          </div>
        </div>

        {/* 전술핵 — 울릉도·제주 사일로 보유 시에만 별도 액션 */}
        {nukeOwned && (
          <button
            type="button"
            className={`io-btn io-btn-sm io-btn-block ${isNukeAiming ? "io-btn-amber" : "io-btn-primary"}`}
            style={{ marginTop: 8 }}
            disabled={nukeCooldownLeft > 0 && !isNukeAiming}
            onClick={() => setNukeAiming(!isNukeAiming)}
          >
            {isNukeAiming
              ? "☢ 핵 조준 중 (Esc)"
              : nukeCooldownLeft > 0
                ? `☢ 재장전 ${nukeCoolSec}초`
                : "☢ 전술핵 발사"}
          </button>
        )}

        {/* 조작 안내 — 지도 클릭으로 쓰는 것들(버튼 없음)과 기술 요약 */}
        <div style={{ marginTop: 10, borderTop: "1px solid #ffffff22", paddingTop: 8 }}>
          <div className="hud-ratio-head">
            <span className="hud-title">공격 큐 ⚔️</span>
            <strong className="hud-ratio-value" style={{ fontSize: 12 }}>
              {attackQueueCount > 0 ? `${attackQueueCount}곳` : "없음"}
            </strong>
          </div>
          <div className="hud-ratio-hint">
            적·중립 지역 <strong>우클릭</strong> = 큐 담기·빼기 · 인접한 내 동이 자동 공격
          </div>

          <div className="hud-ratio-head" style={{ marginTop: 8 }}>
            <span className="hud-title">집결지 🚩</span>
            <strong className="hud-ratio-value" style={{ fontSize: 12 }}>
              {rallyName ?? "없음"}
            </strong>
          </div>
          <div className="hud-ratio-hint">
            내 동 <strong>더블클릭</strong> = 지정·해제 · 후방 병력이 매 초 한 칸씩 집결
          </div>
        </div>
      </div>

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
                className="io-btn io-btn-ghost"
                type="button"
                onClick={() => {
                  setDefeated(false);
                  if (isMock) {
                    setPhase("join");
                  } else {
                    connection?.leaveRoom();
                    connection?.listRooms();
                    setPhase("lobby");
                  }
                }}
              >
                {isMock ? "메인 화면" : "로비로"}
              </button>
              <button
                className="io-btn io-btn-primary"
                type="button"
                onClick={() => {
                  connection?.sendRestart();
                  setDefeated(false);
                }}
              >
                ▶ 재시작
              </button>
            </div>
          </div>
        </div>
      )}

      {victorious && (
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
              border: "1px solid #ffcc3355",
              borderRadius: 14,
              padding: "28px 34px",
              textAlign: "center",
              boxShadow: "0 12px 44px rgba(0,0,0,0.55)",
              minWidth: 280,
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 2, color: "#ffcc33" }}>
              🎉 대통령 당선 — 우승!
            </div>
            <p style={{ margin: "12px 0 22px", color: "#cdd6e4", fontSize: 14 }}>
              전체 동의 {Math.round(CONFIG.PRESIDENT_WIN_RATIO * 100)}% 이상을 점유했습니다.
            </p>
            <button
              type="button"
              onClick={() => setVictorious(false)}
              style={{
                padding: "9px 22px",
                borderRadius: 8,
                border: "1px solid #ffffff33",
                background: "#3a4a5e",
                color: "#fff",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              계속 플레이
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
