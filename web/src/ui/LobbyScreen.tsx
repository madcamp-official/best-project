import { useState } from "react";
import { useUIStore } from "../store/uiStore";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection;
}

// 로비(io 스타일) — 큰 로고 + 닉네임 + 방 만들기(청키 버튼) + 카드형 공개 방 목록.
// 방 목록은 서버가 /topic/rooms로 계속 밀어줘 자동 갱신된다(생성/참가/이탈/시작 시).
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
      <div className="join-card io-card">
        <h1 className="io-logo">
          영토점령<span className="accent">.io</span>
        </h1>
        <p className="io-tagline">실제 전국 법정동 지도에서 벌이는 실시간 영토 전쟁</p>

        <input
          className="join-input"
          type="text"
          value={nickname}
          maxLength={12}
          placeholder="닉네임 (1~12자)"
          autoFocus
          onChange={(e) => setNickname(e.target.value)}
        />

        <div className="io-row" style={{ marginTop: 10 }}>
          <input
            className="join-input"
            type="text"
            value={roomName}
            maxLength={20}
            placeholder="새 방 이름 (선택)"
            style={{ flex: 1 }}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button className="io-btn io-btn-primary" type="button" disabled={!nameOk} onClick={create}>
            방 만들기
          </button>
        </div>

        <div className="io-list-head">
          <span>공개 방 {rooms.length}</span>
          <button className="io-refresh" type="button" onClick={() => connection.listRooms()}>
            ↻ 새로고침
          </button>
        </div>

        <div className="io-room-list">
          {rooms.length === 0 && (
            <div className="io-empty">아직 열린 방이 없어요 — 첫 방을 만들어 보세요!</div>
          )}
          {rooms.map((r) => (
            <div key={r.roomId} className="io-room-item">
              <div>
                <div className="io-room-name">{r.name}</div>
                <div className="io-room-meta">
                  <span className={`io-badge ${r.state === "PLAYING" ? "playing" : "waiting"}`}>
                    {r.state === "PLAYING" ? "게임 중" : "대기 중"}
                  </span>
                  <span>
                    👥 {r.memberCount}/{r.maxMembers}
                  </span>
                </div>
              </div>
              <button
                className={`io-btn io-btn-sm ${r.state === "PLAYING" ? "io-btn-green" : "io-btn-primary"}`}
                type="button"
                disabled={!nameOk || r.memberCount >= r.maxMembers}
                onClick={() => join(r.roomId)}
              >
                {r.memberCount >= r.maxMembers ? "가득 참" : r.state === "PLAYING" ? "난입" : "참가"}
              </button>
            </div>
          ))}
        </div>

        {!nameOk && <p className="join-hint">닉네임을 입력하면 방을 만들거나 참가할 수 있어요</p>}
      </div>
    </div>
  );
}
