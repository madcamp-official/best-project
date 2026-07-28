import { useState } from "react";
import { useUIStore } from "../store/uiStore";

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
    useUIStore.getState().setNickname(name);
    onJoin(name);
  };

  return (
    <div className="join-overlay">
      <div className="join-card">
        <h1 className="io-logo">
          <span className="accent">구청장</span> 시뮬레이터
        </h1>
        <p className="io-tagline">실제 전국 시/군/구 지도 위에서 벌이는 영토 점령전</p>
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
        <button
          className="io-btn io-btn-primary io-btn-lg io-btn-block"
          type="button"
          style={{ marginTop: 12 }}
          disabled={nickname.trim().length === 0}
          onClick={submit}
        >
          ▶ 시작하기
        </button>
        <p className="join-hint">좌클릭으로 내 동 선택 · 우클릭으로 인접 동 이동/공격</p>
      </div>
    </div>
  );
}
