import { useUIStore } from "../store/uiStore";
import { PALETTE } from "../config";
import { world } from "../world/worldView";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection;
}

// 라운드 결과 — 승자 + 최종 순위. 다시 시작(아무나) 또는 로비로. 뒤로 마지막 라운드 지도가 비친다.
export function ResultsOverlay({ connection }: Props) {
  const result = useUIStore((s) => s.roundResult);
  const setPhase = useUIStore((s) => s.setPhase);
  if (!result) return null;

  const leave = () => {
    connection.leaveRoom();
    connection.listRooms();
    setPhase("lobby");
  };
  const reasonText = result.reason === "DOMINATION" ? "전국 석권" : "시간 종료";

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
      <div
        style={{
          background: "#141b28",
          border: "1px solid #ffffff22",
          borderRadius: 14,
          padding: "26px 30px",
          textAlign: "center",
          minWidth: 320,
          maxWidth: 420,
          boxShadow: "0 12px 44px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ fontSize: 13, color: "#8ea2be", letterSpacing: 2 }}>{reasonText}</div>
        <div style={{ fontSize: 30, fontWeight: 900, color: "#ffd24a", margin: "6px 0 4px" }}>
          🏆 {result.winnerName ?? "무승부"}
        </div>
        <p style={{ color: "#cdd6e4", fontSize: 13, margin: "0 0 16px" }}>
          {result.winnerName ? "승리!" : "이번 라운드는 승자가 없습니다."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
          {result.leaderboard.slice(0, 6).map((row, i) => {
            const pal = PALETTE[world.holders.get(row.holderId)?.paletteIdx ?? 0];
            return (
              <div
                key={row.holderId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#0e1826",
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
              >
                <span style={{ color: "#cdd6e4", fontSize: 13 }}>
                  <span style={{ color: "#7d8ba3", marginRight: 8 }}>{i + 1}</span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: pal?.stroke ?? "#888",
                      marginRight: 6,
                    }}
                  />
                  {row.name}
                </span>
                <span style={{ color: "#8ea2be", fontSize: 13 }}>{row.count}개 동</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => connection.startRound()}
            style={{
              padding: "9px 20px",
              borderRadius: 8,
              border: "none",
              background: "#2f7d4f",
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            다시 시작
          </button>
          <button
            type="button"
            onClick={leave}
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
            로비로
          </button>
        </div>
      </div>
    </div>
  );
}
