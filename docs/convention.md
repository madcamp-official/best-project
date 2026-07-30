# 개발 환경/컨벤션 가이드

> Git 커밋/문서 관리 규칙은 저장소 루트 [CLAUDE.md](../CLAUDE.md)가 원본이다 — 이 문서는 **중복 서술하지 않고 코드 컨벤션만** 다룬다.
> 아키텍처는 [architecture.md](./architecture.md), 일정/역할은 [plan.md](./plan.md) 참조.

---

## 1. Git

- 커밋 메시지·문서 관리 브랜치(`dev`)·push 시점 규칙은 [CLAUDE.md](../CLAUDE.md) "Git Commit Convention" / "Document Management" / "Branch Sync" 절을 그대로 따른다. 여기서 반복하지 않는다.
- 역할 분담이 서버(S)/클라(C)로 나뉘므로(plan.md §4), 기능 브랜치는 `feat/server-*`, `feat/client-*` 처럼 담당이 드러나게 짓는 것을 권장(강제 아님).
- **프로토콜(api-spec.md) 변경은 양측 합의 후에만 커밋한다** — Day 1 동결 이후 필드 append만 허용(plan.md §6).

---

## 2. 클라이언트 (`web/`, TypeScript)

### 2.1 도구

| 목적 | 도구 | 명령 |
|---|---|---|
| 빌드/개발 서버 | Vite | `npm run dev` / `npm run build` |
| 린트 | oxlint (`.oxlintrc.json`) | `npm run lint` |
| 타입 체크 | `tsc -b` (빌드에 포함) | `npm run build` |

- `.oxlintrc.json`에 `react/rules-of-hooks: error`가 켜져 있다 — 훅 규칙 위반은 경고가 아니라 빌드 차단으로 취급한다.
- 별도 포매터(Prettier 등) 설정 없음 — 에디터 기본 포맷 + 아래 스타일 규칙을 손으로 맞춘다. 팀에서 필요성이 커지면 도입 논의.

### 2.2 TypeScript 설정에서 강제되는 것 (`tsconfig.app.json`)

- `noUnusedLocals` / `noUnusedParameters`: 안 쓰는 변수·파라미터 금지 — 임시 디버그 변수 남기고 커밋하지 말 것
- `verbatimModuleSyntax`: 타입 전용 import는 `import type { X } from ...`로 명시
- `noFallthroughCasesInSwitch`: switch fallthrough 금지

### 2.3 게임 로직 코드 스타일 (`src/game/`)

**`core.ts`가 지키는 규칙 — 서버 이식 대상이므로 반드시 유지:**

- 순수 함수만. `React`/`MapLibre`/`Zustand`/브라우저 전역(`Date.now()`, `performance.now()` 직접 호출 등) **의존 금지**
- 시간이 필요하면 호출자가 `nowMs`(단조 시각)를 인자로 주입한다. 로그 타임스탬프처럼 벽시계가 필요하면 `wallNowMs`로 별도 주입 — 두 종류를 섞지 않는다(`resolveArrival`의 `wallNowMs` 예시 참조)
- 모든 상태는 `GameState` 하나로 묶어 인자로 받는다. 전역 변수·모듈 스코프 mutable state 금지
- 변경 함수는 함수명에 `try`(검증 후 실패 가능, 예: `trySortie`) / `tick`(주기 실행, 예: `tickProduction`) 접두를 맞춘다
- 250개 시/군/구 셀을 매 프레임 순회하는 코드는 피하고 `dirty: Set<number>` + lazy 계산 패턴을 따른다(`tickProduction`의 `troopAccum` 누산기가 예시)
- 규칙 변경 시 관련 README 절 번호를 주석으로 남긴다 (`// README §4.2, §4.4 — 출정...` 형식) — 이 파일이 서버 이식 시 1:1 대조 사양서 역할을 하기 때문(plan.md §4)

**타입 네이밍 (`src/game/types.ts`):**

- 셀 인덱스는 항상 `admIndex`(조밀 정수)로 부른다. 원본 행정구역코드는 `code`/`sggcd`(시군구 5자리)로 구분해 혼용하지 않는다
- `holderId`는 `number`. 예약값(`0` 중립, `255` 예약=구 환경 세력 E·현재 미사용)은 `config.ts`의 상수로만 참조하고 매직 넘버로 하드코딩하지 않는다

### 2.4 상태 계층 분리

- **게임/월드 상태**(250 시/군/구 셀 배열, `GameState`)는 React/Zustand에 절대 넣지 않는다 — React 밖(`world/worldView.ts`의 `world`)에 유지하고 `dirty` 변경분만 rAF로 MapLibre에 반영(README §7)
- **UI 상태**(선택한 동, 패널 열림 등 소량)만 `store/uiStore.ts`(Zustand)에 둔다
- `map/MapView.tsx`의 MapLibre 인스턴스는 `useRef`로 감싸 `useEffect` 1회만 생성 — 이후 React 렌더가 지도를 직접 건드리지 않는다
- **클라는 게임 로직을 돌리지 않는다**: 입력은 `net/connection.ts`의 `Connection.sendSortie`로 서버에 보내고, 결과는 WELCOME/DELTA로 받아 `worldView`에 반영만 한다(plan.md §3). 기본 연결은 실서버(`stompConnection`)이고, `VITE_USE_LOCAL_MOCK=1`이면 브라우저 내 목 서버(`localConnection`)로 전환된다

### 2.5 폴더 규칙

```
game/   순수 로직 (core.ts) + 공유 타입 (types.ts) — 서버 이식 대상
net/    Connection 인터페이스 + 프로토콜 타입 + 실서버 연결(stompConnection) + 로컬 목 서버(localConnection)
world/  서버 상태 사본(worldView) — WELCOME/DELTA 반영 계층. 게임 로직 없음
data/   경계/인접 그래프 로딩, 좌표 계산 — 게임 규칙과 무관한 데이터 가공
map/    MapLibre 렌더 전용 컴포넌트 (world를 읽고 connection으로 입력 전송)
store/  Zustand — UI 상태만
ui/     HUD 등 프레젠테이션 컴포넌트
```
새 파일을 추가할 때 이 중 어느 계층에 속하는지 먼저 정한다. `core.ts`에 렌더/DOM 코드가 섞이거나 `map/`에 게임 규칙 판단이 섞이면 서버 이식 시 대조가 깨진다. 게임 규칙 판단은 `core.ts`(→서버)에만, `world`/`map`은 반영·렌더만.

### 2.6 입력 처리 (README §4.5 그대로 준수)

- 키 입력은 `e.code`(물리 키) 사용, `e.key` 금지(한글 IME 충돌)
- `e.isComposing || e.keyCode === 229` 필터로 IME 조합 중 입력 무시

---

## 3. 서버 (Spring Boot 4 · Kotlin)

- 언어는 Kotlin으로 확정. `kotlin("plugin.spring")`이 `@Component`/`@Service` 등이 붙은 클래스를 자동으로 `open`으로 만드는데, 그 상태에서 `private set`이 붙은 프로퍼티는 Kotlin이 거부한다(`Private setters for open properties are prohibited`) — 그런 클래스에선 프로퍼티에 `final`을 명시한다(`GameLoop.world`, `ConfigService.current` 참조).
- Jackson 3(`tools.jackson.*` 패키지, 이 프로젝트의 Spring Boot 4 조합)로 이식하면서 알게 된 것: `jackson-annotations`(`@JsonProperty` 등)만은 여전히 구 패키지 `com.fasterxml.jackson.annotation`을 쓴다. `ObjectMapper`/`JsonNode`는 `tools.jackson.databind.*`.
- **`core.ts`를 사양서로 1:1 대조 이식**한다(plan.md §4) — `GameCore.kt`가 그 결과물. 순수 함수·시계 주입 원칙(§2.3)도 그대로 지켰다.
- **동시성**: World는 `GameLoop`의 단일 스레드 executor에서만 mutate한다. 락 대신 "결국 한 스레드만 건드린다"는 구조로 경합을 원천 차단 — 새 명령/조회를 추가할 때도 반드시 `GameLoop.runOnLoop{}`/`submitOnLoop{}`를 거치게 할 것. 직접 `World`를 참조해 컨트롤러에서 바로 수정하면 이 보장이 깨진다.
- 실제 모듈 구성·상세 실행법은 [server/README.md](../server/README.md) 참조. 아키텍처 개요는 [architecture.md](./architecture.md) §3.

---

## 4. 튜닝 값 (`CONFIG`)

- 밸런스 상수는 반드시 `src/config.ts`의 `CONFIG` 객체 한 곳에 모은다 — 로직 코드에 매직 넘버로 흩뿌리지 않는다(README §5)
- **서버가 원본**이다: 서버 `GameConfig.kt`의 값이 입장 시 `WELCOME.config`로 클라에 전달된다(README §8, [api-spec.md](./api-spec.md) §3.2). 클라 `config.ts`는 목 서버(`localConnection`)·개발용 fallback으로 쓰이며, 두 파일의 키·기본값은 항상 1:1로 맞춘다.

---

## 5. 문서 갱신 원칙

- 코드와 문서가 어긋나면 **코드가 기준**이다. README/api-spec.md/architecture.md를 코드에 맞춰 갱신한다(api-spec.md §5 참조).
- `docs/plan.md`는 초기 6일 계획의 **기록(historical)**이다 — 현재 사양과 다를 수 있으니 갱신하지 않고 그대로 둔다. 현재 사양은 README·architecture·api-spec가 원본.
