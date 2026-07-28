// 구글 로그인 계정 REST 클라이언트 — 게임 자체(STOMP)와 별개로, 프로필/친구 조회는 평범한
// fetch로 처리한다(net/stompConnection.ts의 defaultWsUrl과 같은 규칙으로 서버 주소를 잡는다).

function defaultApiUrl(): string {
  const isViteDev = window.location.port === "5173";
  const host = isViteDev ? `${window.location.hostname}:8080` : window.location.host;
  return `${window.location.protocol}//${host}`;
}

const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? defaultApiUrl();

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} 요청 실패 (${res.status})`);
  return res.json() as Promise<T>;
}

export interface AccountProfile {
  appUserId: number;
  nickname: string;
  level: number;
  wins: number;
  gamesPlayed: number;
}

export function fetchMyProfile(idToken: string): Promise<AccountProfile> {
  return post<AccountProfile>("/api/account/me", { idToken });
}

export interface FriendCandidate {
  appUserId: number;
  nickname: string;
  level: number;
}

export interface PendingRequest {
  requestId: number;
  appUserId: number;
  nickname: string;
}

export interface FriendsList {
  friends: FriendCandidate[];
  incoming: PendingRequest[];
  outgoing: PendingRequest[];
}

export function searchFriendCandidates(idToken: string, query: string): Promise<FriendCandidate[]> {
  return post<FriendCandidate[]>("/api/friends/search", { idToken, query });
}

export function sendFriendRequest(
  idToken: string,
  targetAppUserId: number,
): Promise<{ ok: boolean; message: string }> {
  return post("/api/friends/request", { idToken, targetAppUserId });
}

export function respondFriendRequest(
  idToken: string,
  requestId: number,
  accept: boolean,
): Promise<{ ok: boolean; message: string }> {
  return post("/api/friends/respond", { idToken, requestId, accept });
}

export function fetchFriendsList(idToken: string): Promise<FriendsList> {
  return post<FriendsList>("/api/friends/list", { idToken });
}
