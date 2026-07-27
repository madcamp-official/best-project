import { useUIStore } from "../store/uiStore";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection;
}

// 대기실 — 현재 방의 멤버 목록 + 시작(아무나) + 나가기. 라운드가 시작되면 WELCOME이 오며 지도로 전환된다.
export function RoomWaitScreen({ connection }: Props) {
  const currentRoom = useUIStore((s) => s.currentRoom);
  const members = useUIStore((s) => s.members);
  const setPhase = useUIStore((s) => s.setPhase);

  const leave = () => {
    connection.leaveRoom();
    connection.listRooms();
    setPhase("lobby");
  };

  return (
    <div className="join-overlay">
      <div className="join-card" style={{ minWidth: 380, maxWidth: 480 }}>
        <h1 className="join-title" style={{ fontSize: 26 }}>
          {currentRoom?.name ?? "방"}
        </h1>
        <p className="join-sub">모두 모이면 아무나 시작을 누르세요 (최소 1명, 혼자면 야만인이 상대)</p>
        <div style={{ margin: "12px 0", display: "flex", flexDirection: "column", gap: 6 }}>
          {members.map((m, i) => (
            <div
              key={`${m.nickname}-${i}`}
              style={{
                background: "#0e1826",
                border: "1px solid #ffffff14",
                borderRadius: 8,
                padding: "9px 12px",
                color: "#e6edf6",
                textAlign: "left",
              }}
            >
              {m.nickname}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="join-button"
            type="button"
            style={{ flex: 1, margin: 0 }}
            onClick={() => connection.startRound()}
          >
            게임 시작
          </button>
          <button
            type="button"
            onClick={leave}
            style={{
              padding: "0 18px",
              borderRadius: 8,
              border: "1px solid #ffffff33",
              background: "#3a4a5e",
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            나가기
          </button>
        </div>
      </div>
    </div>
  );
}
