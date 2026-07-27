import { useState } from "react";
import { useUIStore } from "../store/uiStore";
import type { Connection } from "../net/connection";
import { DEFAULT_MAP_ID, MAP_DISPLAY_NAMES } from "../data/loadMapData";

interface Props {
  connection: Connection;
}

// 로비에서 고를 수 있는 지도 목록(순서 그대로 라디오에 표시). data/loadMapData.ts의
// MAP_DISPLAY_NAMES와 짝을 맞춘다 — 새 지도를 추가하면 여기 한 줄만 더하면 된다.
const MAP_OPTIONS: string[] = Object.keys(MAP_DISPLAY_NAMES);

// 로비(2단) — 왼쪽: 공개 방 리스트, 오른쪽: 브랜딩 + 닉네임 + 방 만들기.
// 방 목록은 서버가 /topic/rooms로 계속 밀어줘 자동 갱신된다(생성/참가/이탈/시작 시).
export function LobbyScreen({ connection }: Props) {
  const rooms = useUIStore((s) => s.rooms);
  const [nickname, setNickname] = useState(() => localStorage.getItem("nickname") ?? "");
  const [roomName, setRoomName] = useState("");
  const [mapId, setMapId] = useState<string>(DEFAULT_MAP_ID);
  const nameOk = nickname.trim().length > 0;

  const token = () => localStorage.getItem("token") ?? undefined;
  const saveNick = () => localStorage.setItem("nickname", nickname.trim());

  const create = () => {
    if (!nameOk) return;
    saveNick();
    connection.createRoom(roomName.trim() || `${nickname.trim()}의 방`, mapId, nickname.trim(), token());
  };
  const join = (roomId: string) => {
    if (!nameOk) return;
    saveNick();
    connection.joinRoom(roomId, nickname.trim(), token());
  };

  return (
    <div className="join-overlay">
      <div className="lobby-shell">
        {/* 왼쪽: 공개 방 리스트 */}
        <div className="lobby-left">
          <div className="io-list-head" style={{ margin: "0 2px 12px" }}>
            <span>공개 방 {rooms.length}</span>
            <button className="io-refresh" type="button" onClick={() => connection.listRooms()}>
              ↻ 새로고침
            </button>
          </div>
          <div className="lobby-rooms">
            {rooms.length === 0 && (
              <div className="io-empty">
                아직 열린 방이 없어요
                <br />
                오른쪽에서 첫 방을 만들어 보세요!
              </div>
            )}
            {rooms.map((r) => {
              const full = r.memberCount >= r.maxMembers;
              return (
                <div key={r.roomId} className="io-room-item">
                  <div style={{ minWidth: 0 }}>
                    <div className="io-room-name">{r.name}</div>
                    <div className="io-room-meta">
                      <span className={`io-badge ${r.state === "PLAYING" ? "playing" : "waiting"}`}>
                        {r.state === "PLAYING" ? "게임 중" : "대기 중"}
                      </span>
                      <span className="io-badge">{MAP_DISPLAY_NAMES[r.mapId] ?? r.mapId}</span>
                      <span>
                        👥 {r.memberCount}/{r.maxMembers}
                      </span>
                    </div>
                  </div>
                  <button
                    className={`io-btn io-btn-sm ${r.state === "PLAYING" ? "io-btn-green" : "io-btn-primary"}`}
                    type="button"
                    disabled={!nameOk || full}
                    onClick={() => join(r.roomId)}
                  >
                    {full ? "가득 참" : r.state === "PLAYING" ? "난입" : "참가"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* 오른쪽: 브랜딩 + 닉네임 + 방 만들기 */}
        <div className="lobby-right">
          <h1 className="io-logo">
            <span className="accent">동대장</span> 시뮬레이터
          </h1>
          <p className="io-tagline">
            실제 전국 법정동 지도에서
            <br />
            벌이는 실시간 영토 전쟁
          </p>

          <div className="lobby-form">
            <label className="lobby-label">닉네임</label>
            <input
              className="join-input"
              type="text"
              value={nickname}
              maxLength={12}
              placeholder="닉네임 (1~12자)"
              autoFocus
              onChange={(e) => setNickname(e.target.value)}
            />

            <label className="lobby-label" style={{ marginTop: 16 }}>
              방 만들기
            </label>
            <input
              className="join-input"
              type="text"
              value={roomName}
              maxLength={20}
              placeholder="새 방 이름 (선택)"
              onChange={(e) => setRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {MAP_OPTIONS.map((id) => (
                <label
                  key={id}
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#9fb0c8" }}
                >
                  <input
                    type="radio"
                    name="mapId"
                    checked={mapId === id}
                    onChange={() => setMapId(id)}
                  />
                  {MAP_DISPLAY_NAMES[id]}
                </label>
              ))}
            </div>
            <button
              className="io-btn io-btn-primary io-btn-lg io-btn-block"
              type="button"
              style={{ marginTop: 10 }}
              disabled={!nameOk}
              onClick={create}
            >
              + 새 방 만들기
            </button>

            {!nameOk && <p className="join-hint">닉네임을 입력하면 방을 만들거나 참가할 수 있어요</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
