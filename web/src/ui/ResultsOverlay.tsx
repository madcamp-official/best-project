import { useUIStore } from "../store/uiStore";
import { PALETTE } from "../config";
import { world } from "../world/worldView";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// 라운드 결과(io 스타일) — 승자 배너 + 메달 순위 + 다시 시작/로비. 뒤로 마지막 라운드 지도가 비친다.
export function ResultsOverlay({ connection }: Props) {
  const result = useUIStore((s) => s.roundResult);
  const myHolderId = useUIStore((s) => s.myHolderId);
  const setPhase = useUIStore((s) => s.setPhase);
  if (!result) return null;

  const leave = () => {
    connection.leaveRoom();
    connection.listRooms();
    setPhase("lobby");
  };
  const iWon = result.winnerHolderId === myHolderId;
  const total = result.leaderboard.reduce((sum, r) => sum + r.count, 0);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(6,10,20,0.78)",
        zIndex: 120,
      }}
    >
      <div className="join-card io-card" style={{ maxWidth: 440 }}>
        <span className={`io-badge ${result.reason === "DOMINATION" ? "playing" : "waiting"}`}>
          {result.reason === "DOMINATION" ? "전국 석권" : "시간 종료"}
        </span>
        <div style={{ fontSize: 34, fontWeight: 900, color: iWon ? "#ffd24a" : "#f1f5f9", margin: "10px 0 2px" }}>
          {iWon ? "🏆 승리!" : result.winnerName ? `🏆 ${result.winnerName}` : "무승부"}
        </div>
        <p className="io-tagline" style={{ marginBottom: 16 }}>
          {iWon
            ? "이번 라운드의 지배자가 되었습니다"
            : result.winnerName
              ? "다음 라운드에 설욕하세요"
              : "이번 라운드는 승자가 없습니다"}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 20 }}>
          {result.leaderboard.slice(0, 6).map((row, i) => {
            const pal = PALETTE[world.holders.get(row.holderId)?.paletteIdx ?? 0];
            const pct = total > 0 ? ((row.count / total) * 100).toFixed(1) : "0.0";
            return (
              <div
                key={row.holderId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "rgba(11,18,32,0.92)",
                  border: `1px solid ${row.holderId === myHolderId ? "rgba(232,72,79,0.5)" : "rgba(148,163,184,0.15)"}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                }}
              >
                <span style={{ width: 24, fontSize: i < 3 ? 15 : 12, color: "#8ea2be", fontWeight: 700 }}>
                  {MEDALS[i] ?? i + 1}
                </span>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: pal?.stroke ?? "#888",
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "#e6edf6", fontSize: 13, fontWeight: row.holderId === myHolderId ? 800 : 600 }}>
                  {row.name}
                </span>
                <span style={{ marginLeft: "auto", color: "#8ea2be", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                  {row.count}동 · {pct}%
                </span>
              </div>
            );
          })}
        </div>

        <div className="io-row">
          <button
            className="io-btn io-btn-green io-btn-lg"
            type="button"
            style={{ flex: 1 }}
            onClick={() => connection.startRound()}
          >
            ▶ 다시 시작
          </button>
          <button className="io-btn io-btn-ghost" type="button" onClick={leave}>
            로비로
          </button>
        </div>
      </div>
    </div>
  );
}
