import type { InviteMessage } from "../net/protocol";

interface Props {
  invite: InviteMessage;
  onAccept: () => void;
  onDismiss: () => void;
}

// 친구가 나를 방으로 부르면 화면 위쪽에 뜨는 알림. 클릭 한 번으로 그 방에 들어간다 —
// 초대 코드를 복사해 다른 앱으로 보내던 단계를 없애는 게 이 배너의 목적이다.
// 게임 중(ready)에는 띄우지 않는다(App에서 phase로 거른다) — 플레이를 가리면 안 되므로.
export function InviteBanner({ invite, onAccept, onDismiss }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 16px",
        borderRadius: 12,
        background: "#141b28",
        border: "1px solid rgba(255,210,74,0.55)",
        boxShadow: "0 10px 34px rgba(0,0,0,0.5)",
        maxWidth: "min(92vw, 460px)",
      }}
    >
      <span style={{ fontSize: 22, flexShrink: 0 }}>✉️</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
          {invite.fromNickname}님의 초대
        </div>
        <div
          style={{
            color: "#9fb0c8",
            fontSize: 12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {invite.roomName}
        </div>
      </div>
      <button className="io-btn io-btn-sm io-btn-primary" type="button" onClick={onAccept}>
        입장
      </button>
      <button className="io-btn io-btn-sm" type="button" onClick={onDismiss}>
        무시
      </button>
    </div>
  );
}
