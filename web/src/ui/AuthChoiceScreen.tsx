import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { isFirebaseConfigured, onAuthStateChanged, signInWithGoogle } from "../auth/firebase";

interface Props {
  onGuest: () => void;
  onLoggedIn: (idToken: string, displayName: string | null) => void;
}

// 진입 관문 — 로비(닉네임/방 목록)로 가기 전에 로그인할지 게스트로 갈지부터 고른다.
// 이미 구글 세션이 남아 있으면(새로고침 등) 팝업 없이 한 번에 이어간다 — 버튼 문구는 닉네임을
// 굳이 박제하지 않고 "구글로 계속하기"로 통일(개인정보를 화면에 그대로 노출하지 않는 편이 낫다).
export function AuthChoiceScreen({ onGuest, onLoggedIn }: Props) {
  const [existingUser, setExistingUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged((user) => setExistingUser(user)), []);

  const handleGoogle = async () => {
    setBusy(true);
    try {
      if (existingUser) {
        onLoggedIn(await existingUser.getIdToken(), existingUser.displayName);
        return;
      }
      const { idToken, displayName } = await signInWithGoogle();
      onLoggedIn(idToken, displayName);
    } catch (e) {
      console.error("[google-signin]", e);
      alert("구글 로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="join-overlay">
      <div className="join-card">
        <h1 className="io-logo">
          <span className="accent">동대장</span> 시뮬레이터
        </h1>
        <p className="io-tagline">
          실제 전국 법정동 지도에서
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
            {busy ? "로그인 중…" : existingUser ? "구글로 계속하기" : "구글 Google로 로그인"}
          </button>
        )}

        <button className="io-btn io-btn-block" type="button" onClick={onGuest} style={{ marginTop: 10 }}>
          게스트로 플레이
        </button>
        <p className="join-hint">로그인하면 레벨과 친구 목록이 계정에 저장됩니다</p>
      </div>
    </div>
  );
}
