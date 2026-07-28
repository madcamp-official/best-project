import type { AccountProfile } from "../auth/api";

interface Props {
  profile: AccountProfile;
  onClose: () => void;
  onLogout: () => void;
}

// 로그인 계정 요약 + 로그아웃. FriendsPanel과 같은 오버레이 패턴(인라인 스타일 모달).
export function MyPage({ profile, onClose, onLogout }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(6,10,20,0.72)",
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#141b28",
          border: "1px solid #ffffff22",
          borderRadius: 14,
          padding: "22px 26px",
          width: 320,
          boxShadow: "0 12px 44px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18, color: "#fff" }}>마이페이지</h2>
          <button className="io-btn io-btn-sm" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div style={{ marginTop: 18, color: "#cdd6e4", fontSize: 14, lineHeight: 2 }}>
          <div>
            닉네임: <strong>{profile.nickname}</strong>
          </div>
          <div>
            레벨: <strong>Lv.{profile.level}</strong>
          </div>
          <div>
            전적: {profile.wins}승 {profile.gamesPlayed}판
          </div>
        </div>

        <button className="io-btn io-btn-block" type="button" onClick={onLogout} style={{ marginTop: 20 }}>
          로그아웃
        </button>
      </div>
    </div>
  );
}
