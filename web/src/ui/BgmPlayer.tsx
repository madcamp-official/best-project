import { useEffect, useRef, useState } from "react";

// 게임 배경음악. App 루트에 상시 마운트해 화면(로비→게임→결과)이 바뀌어도 끊기지 않게 한다.
// 파일은 web/public/bgm.mp3 (Vite가 BASE_URL 아래로 그대로 서빙).
const BGM_SRC = `${import.meta.env.BASE_URL}bgm.mp3`;
const STORAGE_KEY = "bgm-enabled"; // "0" = 사용자가 껐음. 그 외/미설정 = 켜짐(기본).
const VOLUME = 0.35; // 배경음이라 대사·효과를 가리지 않게 낮게.

export function BgmPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) !== "0");

  // enabled(재생 의사)에 맞춰 재생/정지. 브라우저 자동재생 정책상 첫 사용자 제스처 전에는
  // play()가 거부되므로, 거부되면 최초 클릭/키입력 때 한 번 더 시도한다(로그인·닉네임 입력 등에서 곧 발생).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = VOLUME;
    if (!enabled) {
      audio.pause();
      return;
    }
    const onGesture = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      audio.play().catch(() => {});
    };
    audio.play().catch(() => {
      // 자동재생 차단 — 최초 제스처에서 재시도.
      window.addEventListener("pointerdown", onGesture);
      window.addEventListener("keydown", onGesture);
    });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [enabled]);

  const toggle = () => {
    setEnabled((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <>
      <audio ref={audioRef} src={BGM_SRC} loop preload="auto" />
      <button
        type="button"
        className="bgm-toggle"
        onClick={toggle}
        aria-label={enabled ? "배경음악 끄기" : "배경음악 켜기"}
        title={enabled ? "배경음악 끄기" : "배경음악 켜기"}
      >
        {enabled ? "🔊" : "🔇"}
      </button>
    </>
  );
}
