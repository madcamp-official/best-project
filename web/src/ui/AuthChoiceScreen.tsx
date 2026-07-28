import { useState } from "react";
import { isFirebaseConfigured, signInWithGoogle } from "../auth/firebase";

interface Props {
  onGuest: () => void;
  onLoggedIn: (idToken: string, displayName: string | null, photoURL: string | null) => void;
}

// 진입 관문 — 로비(닉네임/방 목록)로 가기 전에 로그인할지 게스트로 갈지부터 고른다.
// 이미 구글 세션이 남아 있어도 항상 팝업(signInWithGoogle)을 띄운다 — 캐시된 세션을 조용히
// 재사용하면 버튼을 눌러도 화면이 그대로라 "로그인이 안 된다"로 보이고, 만료된 캐시 토큰이 서버에
// 거부되면 프로필이 안 잡혀 친구 기능도 열리지 않는다. 팝업은 항상 새 토큰을 준다.
export function AuthChoiceScreen({ onGuest, onLoggedIn }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      const { idToken, displayName, photoURL } = await signInWithGoogle();
      onLoggedIn(idToken, displayName, photoURL);
    } catch (e) {
      console.error("[google-signin]", e);
      // 팝업 차단·사용자 취소는 흔한 실패라 원인을 화면에 그대로 보여준다(무성 실패 방지).
      const code = (e as { code?: string }).code ?? "";
      setError(
        code === "auth/popup-blocked"
          ? "브라우저가 팝업을 차단했습니다 — 주소창의 팝업 허용을 켠 뒤 다시 시도해주세요."
          : code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"
            ? "로그인 창이 닫혔습니다 — 다시 시도해주세요."
            : `구글 로그인에 실패했습니다: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="join-overlay">
      <div className="join-card">
        <h1 className="io-logo">
          <span className="accent">구청장</span> 시뮬레이터
        </h1>
        <p className="io-tagline">
          실제 전국 시/군/구 지도에서
          <br />
          벌이는 실시간 영토 전쟁
        </p>

        {isFirebaseConfigured && (
          <button
            className="io-btn io-btn-primary io-btn-lg io-btn-block"
            type="button"
            disabled={busy}
            onClick={handleGoogle}
            style={{ marginTop: 18 }}
          >
            {busy ? "로그인 중…" : "Google로 로그인"}
          </button>
        )}

        <button className="io-btn io-btn-block" type="button" onClick={onGuest} style={{ marginTop: 10 }}>
          게스트로 플레이
        </button>
        {error ? (
          <p className="join-hint" style={{ color: "#ff8a8a" }}>
            {error}
          </p>
        ) : (
          <p className="join-hint">로그인하면 레벨과 친구 목록이 계정에 저장됩니다</p>
        )}
      </div>
    </div>
  );
}
