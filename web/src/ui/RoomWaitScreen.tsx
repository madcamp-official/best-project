import { useUIStore } from "../store/uiStore";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection;
  // 대기실에서도 친구를 더 부를 수 있어야 한다(정원 8명) — 없으면 첫 한 명만 초대하고 끝난다.
  // 로그인 유저에게만 전달된다(게스트는 null → 버튼을 숨긴다).
  onOpenFriends: (() => void) | null;
  onlineFriendCount: number;
}

// 대기실(io 스타일) — 방장(👑)만 시작할 수 있고, 나머지는 준비 토글. 방장 제외 전원 준비 시 시작 가능.
// 슬롯 점 색: 방장=금색, 준비 완료=초록, 대기=회색. 라운드가 시작되면 WELCOME이 와서 지도로 전환된다.
export function RoomWaitScreen({ connection, onOpenFriends, onlineFriendCount }: Props) {
  const currentRoom = useUIStore((s) => s.currentRoom);
  const members = useUIStore((s) => s.members);
  const rooms = useUIStore((s) => s.rooms);
  const isRoomHost = useUIStore((s) => s.isRoomHost);
  const myReady = useUIStore((s) => s.myReady);
  const setMyReady = useUIStore((s) => s.setMyReady);
  const setPhase = useUIStore((s) => s.setPhase);

  // 정원은 방 목록(/topic/rooms)에서 조회 — 목록에 없으면(직후 타이밍) 기본 8.
  const maxMembers = rooms.find((r) => r.roomId === currentRoom?.roomId)?.maxMembers ?? 8;
  const slots = Array.from({ length: maxMembers }, (_, i) => members[i] ?? null);
  // 방장 제외 전원 준비됐는가 — 방장의 시작 버튼 활성 조건(서버도 동일 조건을 재검증).
  const allReady = members.every((m) => m.host || m.ready);

  const leave = () => {
    connection.leaveRoom();
    connection.listRooms();
    setPhase("lobby");
  };
  const toggleReady = () => {
    connection.setReady(!myReady);
    setMyReady(!myReady); // 낙관적 갱신 — 서버 브로드캐스트(멤버 ready)가 최종 진실
  };

  return (
    <div className="join-overlay">
      <div className="join-card io-card">
        <span className="io-badge waiting">대기실</span>
        <h1 className="io-logo" style={{ fontSize: 28, marginTop: 8 }}>
          {currentRoom?.name ?? "방"}
        </h1>
        <p className="io-tagline">
          {isRoomHost ? "👑 방장 — 모두 준비되면 시작" : "준비 완료를 누르세요"}
        </p>

        {currentRoom?.joinCode && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              margin: "4px 0 14px",
              padding: "8px 14px",
              borderRadius: 8,
              background: "rgba(255,210,74,0.1)",
              border: "1px solid rgba(255,210,74,0.4)",
            }}
          >
            <span style={{ fontSize: 13, color: "#ffd24a" }}>초대 코드</span>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 3, color: "#fff" }}>
              {currentRoom.joinCode}
            </span>
            <button
              className="io-btn io-btn-sm"
              type="button"
              onClick={() => navigator.clipboard?.writeText(currentRoom.joinCode ?? "")}
            >
              복사
            </button>
          </div>
        )}

        {/* 정원이 8명이라 여기서 친구를 계속 더 부를 수 있어야 한다 — 초대는 상대 화면에
            알림으로 바로 뜨고, 접속 중인 친구가 없으면 위 초대 코드를 공유하면 된다. */}
        {onOpenFriends && (
          <button
            className="io-btn io-btn-block"
            type="button"
            onClick={onOpenFriends}
            style={{ marginBottom: 12 }}
          >
            👥 친구 초대
            {onlineFriendCount > 0 && (
              <span style={{ color: "#5fd68a", marginLeft: 6 }}>{onlineFriendCount}명 접속 중</span>
            )}
          </button>
        )}

        <div className="io-slots">
          {slots.map((m, i) =>
            m ? (
              <div key={`m-${i}`} className="io-slot">
                <span
                  className="io-slot-dot"
                  style={{
                    background: m.host ? "#ffd24a" : m.ready ? "#54d488" : "rgba(148,163,184,0.35)",
                  }}
                />
                {m.host ? `👑 ${m.nickname}` : m.nickname}
                {!m.host && m.ready && (
                  <span style={{ marginLeft: "auto", color: "#54d488", fontSize: 11, fontWeight: 800 }}>준비 ✓</span>
                )}
              </div>
            ) : (
              <div key={`e-${i}`} className="io-slot empty">
                <span className="io-slot-dot" />빈 자리
              </div>
            )
          )}
        </div>

        <div className="io-row">
          {isRoomHost ? (
            <button
              className="io-btn io-btn-green io-btn-lg"
              type="button"
              style={{ flex: 1 }}
              disabled={!allReady}
              onClick={() => connection.startRound()}
            >
              ▶ 게임 시작
            </button>
          ) : (
            <button
              className={`io-btn io-btn-lg ${myReady ? "io-btn-ghost" : "io-btn-green"}`}
              type="button"
              style={{ flex: 1 }}
              onClick={toggleReady}
            >
              {myReady ? "준비 취소" : "✅ 준비 완료"}
            </button>
          )}
          <button className="io-btn io-btn-ghost" type="button" onClick={leave}>
            나가기
          </button>
        </div>
      </div>
    </div>
  );
}
