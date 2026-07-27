import { useUIStore } from "../store/uiStore";
import type { Connection } from "../net/connection";

interface Props {
  connection: Connection;
}

// 대기실(io 스타일) — 방 이름 + 플레이어 슬롯 그리드(빈 자리 표시) + 큰 시작 버튼.
// 누구나 시작할 수 있고(최소 1명), 라운드가 시작되면 WELCOME이 와서 지도로 전환된다.
export function RoomWaitScreen({ connection }: Props) {
  const currentRoom = useUIStore((s) => s.currentRoom);
  const members = useUIStore((s) => s.members);
  const rooms = useUIStore((s) => s.rooms);
  const setPhase = useUIStore((s) => s.setPhase);

  // 정원은 방 목록(/topic/rooms)에서 조회 — 목록에 없으면(직후 타이밍) 기본 8.
  const maxMembers = rooms.find((r) => r.roomId === currentRoom?.roomId)?.maxMembers ?? 8;
  const slots = Array.from({ length: maxMembers }, (_, i) => members[i] ?? null);

  const leave = () => {
    connection.leaveRoom();
    connection.listRooms();
    setPhase("lobby");
  };

  return (
    <div className="join-overlay">
      <div className="join-card io-card">
        <span className="io-badge waiting">대기실</span>
        <h1 className="io-logo" style={{ fontSize: 28, marginTop: 8 }}>
          {currentRoom?.name ?? "방"}
        </h1>
        <p className="io-tagline">
          누구나 시작할 수 있어요 — 혼자 시작하면 야만인(환경 세력)과 대결합니다
        </p>

        <div className="io-slots">
          {slots.map((m, i) =>
            m ? (
              <div key={`m-${i}`} className="io-slot">
                <span className="io-slot-dot" />
                {m.nickname}
              </div>
            ) : (
              <div key={`e-${i}`} className="io-slot empty">
                <span className="io-slot-dot" />
                빈 자리
              </div>
            )
          )}
        </div>

        <div className="io-row">
          <button
            className="io-btn io-btn-green io-btn-lg"
            type="button"
            style={{ flex: 1 }}
            onClick={() => connection.startRound()}
          >
            ▶ 게임 시작
          </button>
          <button className="io-btn io-btn-ghost" type="button" onClick={leave}>
            나가기
          </button>
        </div>
      </div>
    </div>
  );
}
