# 구청장 시뮬레이터 — 웹 클라이언트

React 19 + TypeScript + Vite 6 + MapLibre GL로 만든 게임 클라이언트. **렌더러 + 입력 전송기**이며, 게임 규칙은 서버(또는 브라우저 내 목 서버)가 돌린다. 전체 개요는 루트 [README.md](../README.md), 계층 구조는 [docs/architecture.md](../docs/architecture.md) §2, 코드 컨벤션은 [docs/convention.md](../docs/convention.md) §2 참조.

## 실행

```bash
npm install

# ① 서버 없이 솔로(브라우저 내 목 서버) — 로비 건너뛰고 바로 시작
VITE_USE_LOCAL_MOCK=1 npm run dev          # http://localhost:5173

# ② 실서버 붙이기(멀티플레이) — 서버(:8080)를 먼저 띄운 상태에서
npm run dev                                 # localhost:8080에 자동 연결
```

| 스크립트 | 동작 |
|---|---|
| `npm run dev` | Vite 개발 서버(HMR). `server.host: true`라 같은 WiFi의 다른 기기에서 `LAN IP:5173`으로 접속 가능 |
| `npm run build` | `tsc -b`(타입 체크) + `vite build` → `dist/` |
| `npm run lint` | oxlint (`.oxlintrc.json`) |
| `npm run preview` | 빌드 산출물 로컬 프리뷰 |

> 프로덕션은 서버가 이 `dist/`를 같은 오리진 `:8080`에서 서빙한다(단일 오리진). 배포 상세는 [docs/architecture.md](../docs/architecture.md) §7.

## 환경 변수 (`web/.env.local`)

전부 선택이며, 없으면 합리적 기본값으로 동작한다(구글 로그인만 비활성).

| 변수 | 용도 | 기본 |
|---|---|---|
| `VITE_USE_LOCAL_MOCK` | `"1"` → 브라우저 내 목 서버(백엔드 불필요, 솔로) | 실서버 연결 |
| `VITE_WS_URL` | STOMP 주소 오버라이드 | `window.location`에서 유도(Vite dev :5173 → :8080) |
| `VITE_API_URL` | 계정·친구 REST 주소 오버라이드 | WS와 동일 규칙 |
| `VITE_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` | 구글 로그인(Firebase). 4개 모두 있어야 로그인 버튼 활성 | 없으면 게스트만 |

`.env.example`을 복사해 시작한다. 로그인이 없어도 게스트로 게임 전부를 플레이할 수 있다.

## 폴더 구조

```
src/
  game/    순수 게임 로직 core.ts + 타입 types.ts — 서버(GameCore.kt)와 1:1 미러. React/Map/시계 의존 금지
  net/     Connection 인터페이스 + protocol.ts + stompConnection(실서버) + localConnection(목 서버)
  world/   worldView.ts — 서버 상태 사본(WELCOME/DELTA 반영). 게임 로직 없음
  data/    loadMapData(경계·인접·아크 로딩), labelPoint, sggSpecialty
  map/     MapView.tsx — MapLibre 렌더 전용
  store/   uiStore.ts (Zustand) — UI 상태만(phase·선택 셀 등)
  ui/      로비·대기실·결과·HUD 등 화면 컴포넌트
  auth/    firebase(구글 로그인) + api(계정·친구 REST)
public/    kr-sgg.geojson(시군구 250 경계) · bgm.mp3 · 아이콘 등
```

## 개발 시 주의

- **월드 상태(셀 배열)는 React state에 넣지 않는다.** React 밖 싱글턴 `world/worldView.ts`에 두고 `dirty` 변경분만 rAF로 MapLibre에 반영한다.
- **`game/core.ts`는 순수 함수만.** 서버 이식 대상이라 브라우저 전역(`Date.now()` 등)·React·MapLibre 의존 금지, 시간은 인자로 주입.
- **키 입력은 `e.code`(물리 키)** 사용 — 한글 IME 간섭 방지.
- 자세한 규칙은 [docs/convention.md](../docs/convention.md) §2.
