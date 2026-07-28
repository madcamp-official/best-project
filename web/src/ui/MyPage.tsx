import type { AccountProfile } from "../auth/api";

interface Props {
  loggedIn: boolean; // 로그인 여부의 기준(App의 idToken). profile은 늦게 오거나 실패할 수 있어 기준이 못 된다.
  profile: AccountProfile | null; // 레벨/전적. 아직 안 왔거나 조회 실패면 null이어도 로그인 상태는 유지된다.
  guestNickname: string; // 게스트일 때 표시할 닉네임(uiStore, 로비 입력값과 동기화됨).
  onClose: () => void;
  onLogout: () => void;
  onOpenFriends: () => void; // 로그인 유저 전용 — 친구 검색/요청 패널 열기(idToken만 있으면 동작).
  onLoginPrompt: () => void; // 게스트 전용 — 로그인 관문(AuthChoiceScreen)으로 이동.
}

// 계정 요약 오버레이 — 로그인 유저는 레벨/전적/친구/로그아웃, 게스트는 닉네임 + 로그인 유도만.
// FriendsPanel과 같은 패턴(인라인 스타일 모달).
export function MyPage({
  loggedIn,
  profile,
  guestNickname,
  onClose,
  onLogout,
  onOpenFriends,
  onLoginPrompt,
}: Props) {
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

        {loggedIn ? (
          <>
            <div style={{ marginTop: 18, color: "#cdd6e4", fontSize: 14, lineHeight: 2 }}>
              <div>
                닉네임: <strong>{profile?.nickname ?? guestNickname}</strong>
              </div>
              {/* 전적은 부가 정보 — 아직 못 받아왔어도 로그인·친구·로그아웃은 그대로 쓸 수 있다. */}
              {profile ? (
                <>
                  <div>
                    레벨: <strong>Lv.{profile.level}</strong>
                  </div>
                  <div>
                    전적: {profile.wins}승 {profile.gamesPlayed}판
                  </div>
                </>
              ) : (
                <div style={{ opacity: 0.7 }}>전적을 불러오는 중…</div>
              )}
            </div>

            <button className="io-btn io-btn-block" type="button" onClick={onOpenFriends} style={{ marginTop: 16 }}>
              👥 친구
            </button>
            <button className="io-btn io-btn-block" type="button" onClick={onLogout} style={{ marginTop: 8 }}>
              로그아웃
            </button>
          </>
        ) : (
          <>
            <div style={{ marginTop: 18, color: "#cdd6e4", fontSize: 14 }}>
              닉네임: <strong>{guestNickname || "게스트"}</strong>
            </div>
            <p className="join-hint" style={{ marginTop: 8 }}>
              로그인하면 레벨·전적이 기록되고 친구를 추가할 수 있어요
            </p>
            <button
              className="io-btn io-btn-primary io-btn-block"
              type="button"
              onClick={onLoginPrompt}
              style={{ marginTop: 8 }}
            >
              구글로 로그인
            </button>
          </>
        )}
      </div>
    </div>
  );
}
