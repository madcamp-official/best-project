// 구글 로그인(feat/google-login) — Firebase Authentication만 사용한다(Firestore 등은 안 씀).
// 프로젝트 생성·Google 로그인 활성화는 Firebase 콘솔(https://console.firebase.google.com)에서 하고,
// 발급되는 웹 앱 설정값을 web/.env.local에 채운다(web/.env.example 참고, *.local은 커밋 안 됨).

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  onIdTokenChanged as firebaseOnIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

// 아직 .env.local을 안 채운 팀원 환경에서도 앱이 죽지 않도록 — 이 값이 false면 로그인 버튼을
// 숨기거나 비활성화한다(LobbyScreen/JoinScreen). initializeApp을 필수값 없이 부르면 바로 던진다.
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
);

let app: FirebaseApp | null = null;
if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
} else if (import.meta.env.DEV) {
  console.warn(
    "[firebase] VITE_FIREBASE_* 환경 변수가 없어 구글 로그인이 비활성화됩니다. " +
      "web/.env.example을 참고해 web/.env.local을 채우세요.",
  );
}

const auth = app ? getAuth(app) : null;
const provider = new GoogleAuthProvider();

export interface GoogleSignInResult {
  idToken: string;
  displayName: string | null;
  photoURL: string | null;
}

/** 구글 로그인 팝업 → ID 토큰 획득. Firebase 미설정이면 던진다(호출부가 토스트로 안내). */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  if (!auth) throw new Error("구글 로그인이 설정되지 않았습니다.");
  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  return { idToken, displayName: result.user.displayName, photoURL: result.user.photoURL };
}

/** 이미 로그인된 세션이 있으면(새로고침 등) 알려준다 — 자동 재로그인 UX용. 구독 해제 함수를 반환. */
export function onAuthStateChanged(cb: (user: User | null) => void): () => void {
  if (!auth) return () => {};
  return firebaseOnAuthStateChanged(auth, cb);
}

/**
 * 로그인 상태 + 항상 유효한 ID 토큰을 흘려보낸다. Firebase가 토큰을 갱신할 때마다(약 1시간 주기)
 * 다시 불리므로, 화면이 들고 있던 토큰이 만료돼 서버에 거부되는 일이 없다. 새로고침 뒤 남아 있던
 * 세션도 여기서 복원된다(로그인 상태 유지). 로그아웃/미설정이면 null을 흘린다. 구독 해제 함수 반환.
 */
export function onIdTokenChanged(
  cb: (auth: { idToken: string; displayName: string | null; photoURL: string | null } | null) => void,
): () => void {
  if (!auth) return () => {};
  return firebaseOnIdTokenChanged(auth, async (user) => {
    if (!user) return cb(null);
    try {
      cb({ idToken: await user.getIdToken(), displayName: user.displayName, photoURL: user.photoURL });
    } catch (e) {
      console.error("[firebase] getIdToken 실패", e);
      cb(null);
    }
  });
}

export async function signOutGoogle(): Promise<void> {
  if (auth) await firebaseSignOut(auth);
}
