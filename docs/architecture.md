# 시스템 아키텍처 문서

> 게임 규칙은 [README.md](../README.md), 통신 프로토콜은 [api-spec.md](./api-spec.md), 일정/역할은 [plan.md](./plan.md) 참조.
> 이 문서는 **구성 요소가 어떻게 나뉘고 서로 어떻게 연결되는지**만 다룬다.

---

## 1. 전체 구도

**단일 진실원 원칙**: 게임 로직의 진실은 서버(Spring Boot) 하나에만 둔다. 클라이언트는 렌더러 + 입력 전송기로 축소되며, 예측(client-side prediction) 없이 서버 브로드캐스트만 반영한다(plan.md §3).

```
┌─────────────────────────────┐        WebSocket/STOMP        ┌──────────────────────────────┐
│  브라우저 (web/)              │ ─────────────────────────────▶│  Spring Boot 서버              │
│                              │        SORTIE, JOIN            │                                │
│  MapLibre 렌더 · HUD          │◀───────────────────────────── │  월드 상태 (ownerId/troops)     │
│  좌/우클릭 입력                │   WELCOME, DELTA, LEADERBOARD  │  명령 검증 · tick 루프 · E AI   │
│  스냅샷/델타 반영              │                                │  STOMP 브로드캐스트             │
│  유닛 원 보간                  │                                │                                │
└─────────────────────────────┘                                └──────────────────────────────┘
```

- 현재(목업 단계)는 오른쪽 서버 상자가 없다 — `web/src/game/core.ts`가 브라우저 안에서 서버 역할까지 겸한다(README §0, "목업에서 제외: 서버 권위").
- 온라인 전환 시 `core.ts`의 순수 함수(`tickProduction`, `trySortie`, `tickOrders`, `computeRank` 등)를 **그대로 서버 언어로 이식**한다. 로직을 TS/서버 양쪽에 이중 유지하지 않는다(plan.md §3 — 불일치 버그의 최대 원천).

---

## 2. 클라이언트 (`web/`)

### 2.1 계층 구조

```
web/src/
├─ game/
│  ├─ core.ts      # 순수 도메인 로직 — React/MapLibre/Zustand/브라우저 시계에 의존하지 않음
│  └─ types.ts     # Holder / Order / DongStaticMeta / LogEntry 등 공유 타입
├─ net/
│  ├─ protocol.ts       # WELCOME/DELTA/SORTIE/ERROR/LEADERBOARD 메시지 타입 (api-spec.md)
│  ├─ connection.ts     # Connection 인터페이스 — 클라의 유일한 서버 통신 창구
│  └─ localConnection.ts # 브라우저 내 목 서버 (core.ts를 감싸 tick·메시지 발신). 실서버=STOMP로 교체 예정
├─ world/
│  └─ worldView.ts # 상태 반영 계층 — WELCOME/DELTA를 적용해 두는 "서버 상태 사본" (게임 로직 안 돌림)
├─ data/
│  ├─ loadDong.ts  # admdongkor 로드 + topojson 인접 그래프 추출 (README §2), 전국/시도 필터
│  └─ labelPoint.ts     # polylabel 기반 라벨 좌표 계산
├─ map/
│  └─ MapView.tsx  # MapLibre 인스턴스 (useRef 1회 생성). world를 읽어 렌더, 입력은 connection으로 전송
├─ store/
│  └─ uiStore.ts   # Zustand — 선택 동, HUD 등 "소량"만. 게임 상태(3,500동)는 넣지 않음
├─ ui/
│  └─ Hud.tsx
└─ App.tsx / main.tsx
```

핵심 제약(README §1): **3,500개 동 상태를 React state/Zustand에 넣지 않는다.** `GameState`(`core.ts`)는 `Uint8Array`/`Uint16Array` 기반으로 React 밖에 존재하고, 변경분은 `dirty: Set<number>` 로 모아 `drainDirty()`로 꺼내 MapLibre `setFeatureState`에 배치 반영한다(README §7.3).

### 2.2 `core.ts`가 "서버 이식 사양서"인 이유

`GameState`를 인자로 받고 시간을 호출자가 주입하는 순수 함수로 짜여 있다(파일 상단 주석 참조). 그래서:
- 지금은 브라우저 rAF 루프가 `nowMs`/`wallNowMs`를 주입해 로컬 실행
- 온라인 전환 후에는 서버 tick 루프가 같은 함수 시그니처로 호출 — **로직 자체는 바뀌지 않는다**
- 서버 담당은 이 파일을 Kotlin/Java로 1:1 대조 이식하면 된다(plan.md §4)

### 2.3 클라이언트-서버 경계 (이미 도입됨)

클라는 이미 `Connection` 경유로만 동작한다 — 직접 게임 로직을 돌리지 않는다:
- 로컬 tick 오케스트레이션은 **`net/localConnection.ts`(브라우저 내 목 서버)**로 이동. core.ts를 감싸 tick을 돌리고 WELCOME/DELTA를 발신한다.
- 클라 상태는 **`world/worldView.ts`(스냅샷/델타 반영 계층)** — WELCOME 1회 적용 + DELTA 누적 적용.
- 입력은 `connection.sendSortie` 로 전송, 결과는 DELTA/ERROR로 비동기 수신 (클라 예측 없음).
- **실서버 전환**: `localConnection`을 `StompConnection`으로 교체만 하면 된다. `Connection` 인터페이스·`worldView`·`MapView`는 불변.
- 유닛 이동 보간은 그대로. 실서버에선 `Order.departTick/arriveTick`이 서버 시각 기준이 되므로 `offset` 보정 적용(api-spec.md §3). 목 서버는 클라와 같은 `performance.now()`를 써서 offset≈0.

---

## 3. 서버 (Spring Boot, 미착수)

### 3.1 결정된 사항 (plan.md §2)

| 항목 | 값 |
|---|---|
| 프레임워크 | Spring Boot |
| 언어 | Kotlin 권장(Java 가능) — Day 1 착수 전 서버 담당이 최종 결정 |
| 통신 | WebSocket + STOMP (Day 1 저녁까지 막히면 raw WebSocket + 수동 JSON으로 강등, plan.md §6) |
| 세션 | 게스트 — 닉네임 + UUID 토큰, 로그인 없음 |
| 월드 | 단일 월드 1개 (방 없음) |
| 영속화 | 서버 재시작 시 월드 스냅샷 파일 저장/복구 (plan.md Day 5) |

### 3.2 예상 모듈 구성 (착수 시 확정)

```
server/
├─ world/       # GameState 상당 — ownerId/troops 배열, holders, orders (core.ts 이식)
├─ ws/          # STOMP 컨트롤러 — JOIN/SORTIE 수신, WELCOME/DELTA/LEADERBOARD 발신
├─ session/     # 토큰 발급/검증, 재접속 복구
├─ env/         # 환경 세력(E) AI tick (README §4.6)
└─ data/        # 전국 경계/인접 그래프 리소스 (목업 topojson 산출물을 JSON으로 추출해 포함)
```

- tick 루프: 생산(lazy 계산) → SORTIE 검증 → Order 도착 처리(전투) → E AI → dirty 수집 → DELTA 브로드캐스트(5Hz)
- 명령 검증 순서와 동시성 처리(같은 tick 내 경합)는 Day 4 통합 테스트에서 집중 검증 대상(plan.md §5)

### 3.3 배포

- Spring이 클라 정적 빌드(`web/dist`)를 서빙 — 단일 origin이라 CORS 불필요(plan.md Day 5)
- 데모 당일 네트워크 불안 대비: 로컬 LAN 핫스팟 + `host:true` 폴백 리허설(plan.md §6)

---

## 4. 데이터 파이프라인

```
admdongkor(npm, WGS84 GeoJSON)
   │
   ├─ topojson-server: TopoJSON 변환 (위상 보존)
   ├─ topojson-client neighbors(): 인접 그래프 추출 — 기하 기반 touches() 금지(부동소수점 슬리버, README §2.2)
   ├─ mapshaper dissolve: 시군구 집계 지오메트리 (줌 낮을 때 렌더용, README §7.2)
   └─ polylabel: 각 동 라벨/배지 좌표 (centroid 아님)
   │
   ▼
클라: MapLibre 소스(promoteId: adm_cd 정수화) ── 목업 단계, 시도 필터로 서울/전국 전환
서버: 위 산출물을 JSON 리소스로 포함, WELCOME의 meta/neighborIndex로 1회 전송 ── 온라인 전환 후
```

인덱스 체계: `adm_cd`(8자리, `[시도2][시군구3][읍면동3]`) → 조밀 정수 `admIndex`(0..N-1)로 매핑해 모든 배열/메시지에서 사용(README §2.1, api-spec.md §1).

---

## 5. 성능/렌더링 경로 (README §7 요약)

- 상태 갱신: `dirty Set` + rAF 배치 → 한 프레임 내 중복 변경도 `setFeatureState` 1회
- 병력 숫자: 3,500개를 텍스트 레이어에 넣지 않고, 화면에 보이는 근접 줌 범위만 별도 포인트 소스로 `setData`
- 줌별 표현: 전국(시군구 집계) → 권역(동 경계) → 근접(병력 숫자)을 `fill-opacity` interpolate로 크로스페이드
- 유닛 이동: SVG 아닌 Canvas 오버레이(다수 동시 이동 유닛 대비)

---

## 6. 확장 이음매 (변경 시 재작성 없이 흡수되는 지점)

README §10과 동일한 목록 — 아키텍처 관점에서 왜 이렇게 짰는지만 요약:

| 이음매 | 지금 구조가 흡수하는 이유 |
|---|---|
| `holderId` 간접 계층 | 동 배열이 holderId만 참조 → 팀전 전환 시 `holders` 조회 테이블만 바꾸면 됨, 동 배열/렌더/집계 로직 불변 |
| `Order` 객체(즉시 apply → 거리 기반 arrive) | 전투 판정 로직은 두 모드에서 동일. "언제 apply 하느냐"만 바뀜 |
| E = holder 255 | 동 배열·전투·이동·렌더에 E 특수 분기 없음. AI가 명령을 발주하는 주체일 뿐 |
| `core.ts` 시계 주입 | 브라우저 tick과 서버 tick이 같은 함수를 호출 가능 — 로직 이중 유지 방지 |
| CONFIG 단일 객체 | 클라 튜닝값 → 서버 동기화 상수로 이관 시 소스 위치만 이동, 참조 방식 불변 |
