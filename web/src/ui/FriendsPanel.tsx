import { useEffect, useState } from "react";
import {
  fetchFriendsList,
  respondFriendRequest,
  searchFriendCandidates,
  sendFriendRequest,
  type FriendCandidate,
  type FriendsList,
} from "../auth/api";

interface Props {
  idToken: string;
  onClose: () => void;
}

// 로그인 유저 전용 친구 패널 — 검색해서 요청 보내기, 받은 요청 수락/거절, 친구 목록 보기.
// 게임(WS)과 무관한 계정 기능이라 REST(auth/api.ts)로만 통신한다.
export function FriendsPanel({ idToken, onClose }: Props) {
  const [list, setList] = useState<FriendsList | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    fetchFriendsList(idToken)
      .then(setList)
      .catch(() => setNotice("친구 목록을 불러오지 못했습니다."));
  };

  useEffect(refresh, [idToken]);

  const search = async () => {
    const q = query.trim();
    if (!q) return setResults([]);
    setBusy(true);
    try {
      setResults(await searchFriendCandidates(idToken, q));
    } catch {
      setNotice("검색에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const addFriend = async (targetAppUserId: number) => {
    setBusy(true);
    try {
      const res = await sendFriendRequest(idToken, targetAppUserId);
      setNotice(res.message);
      refresh();
    } catch {
      setNotice("요청 전송에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const respond = async (requestId: number, accept: boolean) => {
    setBusy(true);
    try {
      const res = await respondFriendRequest(idToken, requestId, accept);
      setNotice(res.message);
      refresh();
    } catch {
      setNotice("처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

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
          width: 380,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 12px 44px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18, color: "#fff" }}>친구</h2>
          <button className="io-btn io-btn-sm" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          <input
            className="join-input"
            type="text"
            placeholder="닉네임으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search();
            }}
          />
          <button className="io-btn io-btn-primary io-btn-sm" type="button" disabled={busy} onClick={search}>
            검색
          </button>
        </div>
        {results.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
            {results.map((r) => (
              <li
                key={r.appUserId}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}
              >
                <span style={{ color: "#cdd6e4" }}>
                  {r.nickname} <span style={{ opacity: 0.6 }}>Lv.{r.level}</span>
                </span>
                <button
                  className="io-btn io-btn-sm io-btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => addFriend(r.appUserId)}
                >
                  요청
                </button>
              </li>
            ))}
          </ul>
        )}

        {notice && <p className="join-hint">{notice}</p>}

        {list && list.incoming.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, color: "#9fb0c8", marginTop: 16, marginBottom: 6 }}>받은 요청</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {list.incoming.map((r) => (
                <li
                  key={r.requestId}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}
                >
                  <span style={{ color: "#cdd6e4" }}>{r.nickname}</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button
                      className="io-btn io-btn-sm io-btn-primary"
                      type="button"
                      disabled={busy}
                      onClick={() => respond(r.requestId, true)}
                    >
                      수락
                    </button>
                    <button className="io-btn io-btn-sm" type="button" disabled={busy} onClick={() => respond(r.requestId, false)}>
                      거절
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {list && list.outgoing.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, color: "#9fb0c8", marginTop: 16, marginBottom: 6 }}>보낸 요청</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {list.outgoing.map((r) => (
                <li key={r.requestId} style={{ color: "#8a97ab", padding: "4px 0" }}>
                  {r.nickname} — 응답 대기 중
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 style={{ fontSize: 13, color: "#9fb0c8", marginTop: 16, marginBottom: 6 }}>
          친구 {list ? `(${list.friends.length})` : ""}
        </h3>
        {list && list.friends.length === 0 && <p className="io-empty">아직 친구가 없어요 — 위에서 검색해보세요!</p>}
        {list && list.friends.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {list.friends.map((f) => (
              <li key={f.appUserId} style={{ color: "#cdd6e4", padding: "4px 0" }}>
                {f.nickname} <span style={{ opacity: 0.6 }}>Lv.{f.level}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
