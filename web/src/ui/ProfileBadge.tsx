interface Props {
  nickname: string;
  photoURL: string | null;
  onClick: () => void;
}

// 로그인 상태를 항상 눈에 띄게 — 화면 우측 상단에 고정. 눌러서 마이페이지(레벨/전적/로그아웃)를 연다.
// 구글 프로필 사진이 없으면(또는 아직 못 불러왔으면) 기본 아이콘으로 대체한다.
export function ProfileBadge({ nickname, photoURL, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 14px 5px 5px",
        borderRadius: 999,
        background: "rgba(20,27,40,0.9)",
        border: "1px solid #ffffff33",
        cursor: "pointer",
        color: "#fff",
      }}
      title="마이페이지"
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#3a4a5e",
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {photoURL ? (
          <img src={photoURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          "👤"
        )}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{nickname}</span>
    </button>
  );
}
