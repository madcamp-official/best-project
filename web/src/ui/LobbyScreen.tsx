import { useState } from "react";
import { useUIStore } from "../store/uiStore";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection;
}

// 로비 — 닉네임 입력 + 공개 방 목록 + 방 생성. (실서버 다중 세션)
// 방 목록은 서버가 /topic/rooms로 계속 밀어줘 자동 갱신된다(생성/참가/이탈 시).
export function LobbyScreen({ connection }: Props) {
  const rooms = useUIStore((s) => s.rooms);
  const [nickname, setNickname] = useState(() => localStorage.getItem("nickname") ?? "");
  const [roomName, setRoomName] = useState("");
  const nameOk = nickname.trim().length > 0;

  const token = () => localStorage.getItem("token") ?? undefined;
  const saveNick = () => localStorage.setItem("nickname", nickname.trim());

  const create = () => {
    if (!nameOk) return;
    saveNick();
    connection.createRoom(roomName.trim() || `${nickname.trim()}의 방`, nickname.trim(), token());
  };
  const join = (roomId: string) => {
    if (!nameOk) return;
    saveNick();
    connection.joinRoom(roomId, nickname.trim(), token());
  };

  return (
    <div className="join-overlay">
      <div className="join-card" style={{ minWidth: 420, maxWidth: 520 }}>
        <h1 className="join-title">영토 점령 · 로비</h1>
        <p className="join-sub">방을 만들거나 참가해 라운드를 시작하세요</p>
        <input
          className="join-input"
          type="text"
          value={nickname}
          maxLength={12}
          placeholder="닉네임 (1~12자)"
          autoFocus
          onChange={(e) => setNickname(e.target.value)}
        />

        <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
          <input
            className="join-input"
            type="text"
            value={roomName}
            maxLength={20}
            placeholder="새 방 이름 (선택)"
            style={{ flex: 1, margin: 0 }}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button
            className="join-button"
            type="button"
            disabled={!nameOk}
            style={{ width: "auto", margin: 0, padding: "0 16px", whiteSpace: "nowrap" }}
            onClick={create}
          >
            방 만들기
          </button>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            margin: "6px 2px",
          }}
        >
          <span style={{ color: "#8ea2be", fontSize: 13 }}>공개 방 {rooms.length}개</span>
          <button
            type="button"
            onClick={() => connection.listRooms()}
            style={{ background: "none", border: "none", color: "#8ea2be", cursor: "pointer", fontSize: 13 }}
          >
            새로고침 ↻
          </button>
        </div>

        <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {rooms.length === 0 && (
            <div style={{ color: "#6b7a90", fontSize: 13, padding: "18px 0", textAlign: "center" }}>
              아직 방이 없어요. 위에서 방을 만들어 보세요.
            </div>
          )}
          {rooms.map((r) => (
            <div
              key={r.roomId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#0e1826",
                border: "1px solid #ffffff14",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ textAlign: "left" }}>
                <div style={{ color: "#e6edf6", fontWeight: 700 }}>{r.name}</div>
                <div style={{ color: "#7d8ba3", fontSize: 12 }}>
                  {r.state === "PLAYING" ? "진행 중" : "대기 중"} · {r.memberCount}/{r.maxMembers}명
                </div>
              </div>
              <button
                className="join-button"
                type="button"
                disabled={!nameOk}
                style={{ width: "auto", margin: 0, padding: "6px 14px", fontSize: 13 }}
                onClick={() => join(r.roomId)}
              >
                {r.state === "PLAYING" ? "난입" : "참가"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
