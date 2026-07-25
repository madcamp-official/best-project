import { useState } from "react";

interface Props {
  onJoin: (nickname: string) => void;
}

// 접속 화면 — 닉네임을 입력하고 게임에 참여한다. (plan.md Day 1, api-spec.md JOIN)
export function JoinScreen({ onJoin }: Props) {
  const [nickname, setNickname] = useState(
    () => localStorage.getItem("nickname") ?? ""
  );

  const submit = () => {
    const name = nickname.trim();
    if (name.length === 0) return;
    localStorage.setItem("nickname", name);
    onJoin(name);
  };

  return (
    <div className="join-overlay">
      <div className="join-card">
        <h1 className="join-title">영토 점령</h1>
        <p className="join-sub">실제 전국 행정동 지도 위에서 벌이는 영토 점령전</p>
        <input
          className="join-input"
          type="text"
          value={nickname}
          maxLength={12}
          placeholder="닉네임 (1~12자)"
          autoFocus
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className="join-button" type="button" disabled={nickname.trim().length === 0} onClick={submit}>
          시작하기
        </button>
        <p className="join-hint">좌클릭으로 내 동 선택 · 우클릭으로 인접 동 이동/공격</p>
      </div>
    </div>
  );
}
