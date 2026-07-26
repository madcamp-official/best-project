# API 명세서

> 통신 계층 사양. 게임 규칙 자체는 [README.md](../README.md) §3~§6, 일정/역할은 [plan.md](./plan.md) 참조.
> 프로토콜은 **Day 1 오전에 동결**하고(plan.md §5), 이후 변경은 필드 append만 허용한다(plan.md §6).

---

## 1. 개요

- 전송: **WebSocket + STOMP**, 단일 엔드포인트 `/ws` (SockJS 폴백 열어둘지는 Day 1 결정 사항)
- 월드: 단일 월드 1개 (방 개념 없음) — 모든 클라이언트가 같은 `/topic/*` 을 구독
- 인증: 게스트 세션. 로그인 없음 — `token`(UUID, localStorage 보관)으로 재접속 시 기존 holder 복구
- 진실의 원천은 서버뿐이다. 클라이언트는 예측하지 않고 입력만 보낸 뒤 서버 브로드캐스트를 반영한다(README §9~§10)
- 인덱스 체계: 모든 메시지의 동 참조는 **`admIndex`**(0..N-1 조밀 정수 인덱스, README §2.1) 사용. `adm_cd` 원본 코드는 WELCOME의 정적 메타에만 실린다
- holderId: `0` = 중립, `1..254` = 플레이어, `255` = 환경 세력(`ENV_HOLDER_ID`, README §3.2/§4.6)

### STOMP destination 요약

| 방향 | destination | 메시지 | 주기 |
|---|---|---|---|
| C→S | `/app/join` | JOIN | 접속 시 1회 |
| S→C | `/user/queue/welcome` | WELCOME | JOIN 응답 1회 |
| C→S | `/app/sortie` | SORTIE | 사용자 입력마다 |
| C→S | `/app/missile` | LAUNCH_MISSILE | 발사 버튼 클릭 시 |
| S→C | `/user/queue/error` | ERROR | SORTIE/LAUNCH_MISSILE 거부 시 |
| S→C | `/topic/world` | DELTA | 5Hz |
| S→C | `/topic/leaderboard` | LEADERBOARD | 1Hz |

`/user/queue/*` 는 STOMP user destination(요청자 전용 응답). `/topic/*` 는 전체 브로드캐스트.

---

## 2. 메시지 카탈로그

### 2.1 JOIN (C→S)

최초 접속, 또는 새로고침 후 재접속 시 전송.

```ts
interface JoinMessage {
  nickname: string;      // 신규 참가자만. 1~12자, 서버가 trim/길이 검증
  token?: string;        // 재접속 시 localStorage에 저장된 UUID. 없으면 신규 참가자로 처리
}
```

- 신규 참가자: 서버가 `token`(UUID) 발급 + 시작 동 배정(기존 영토와 안 겹치는 중립 동, 전국에 분산 — plan.md Day 3)
- 재접속(`token` 유효): 기존 holderId·영토·병력 그대로 복구. `nickname`은 무시
- `token`이 유효하지 않으면(만료/오탈자) 신규 참가자로 폴백

### 2.2 WELCOME (S→C, `/user/queue/welcome`)

JOIN에 대한 응답. **전체 스냅샷** 1회 — 이후 변경분은 DELTA로만 온다.

```ts
interface WelcomeMessage {
  holderId: number;          // 이 커넥션의 holderId (재접속 시 기존 값)
  token: string;             // 재접속용 토큰. 클라는 localStorage에 저장
  paletteIdx: number;        // web/src/config.ts PALETTE 인덱스 (fill+stroke 한 쌍, README §7.1)

  config: typeof CONFIG;     // 서버가 원본. plan.md §4 "CONFIG 값은 서버가 원본". ENV_HOLDER_ID 포함(web/src/config.ts)
  serverTimeMs: number;      // 시간 동기화용 서버 시각(§3 참조)

  // 정적 메타 — 게임 중 불변, 1회만 전송
  meta: DongStaticMeta[];    // admIndex 순서 배열. README §3.3
  neighborIndex: number[][]; // admIndex → 인접 admIndex 목록

  // 가변 상태 — 이후 DELTA로만 갱신
  ownerId: Uint8Array | number[];   // admIndex별 holderId
  troops: Uint16Array | number[];   // admIndex별 현재 병력
  troopCap: Uint16Array | number[]; // admIndex별 병력 상한
  holders: Holder[];                // 현재 존재하는 모든 holder(중립·환경세력 포함)
  orders: Order[];                  // 진행 중인 이동 유닛(재접속 시 화면에 이어서 보간)
  missiles: number[];               // 미사일이 얹혀 있는 동 admIndex 목록 (§2.3b 참조)
}
```

```ts
interface Holder { id: number; name: string; paletteIdx: number; } // web/src/game/types.ts와 동일

interface DongStaticMeta {
  admIndex: number;
  code: string;   // adm_cd 8자리
  name: string;
  sggcd: string; sggnm: string;
  sidocd: string; sidonm: string;
  centroid: [number, number];
}
```

- 전국 ~3,500동 기준 스냅샷은 접속 시 1회이므로 JSON 그대로 전송(plan.md §3 — 바이너리 최적화 불필요)
- `troops`/`ownerId`/`troopCap`은 TypedArray를 JSON 직렬화하면 일반 배열이 된다. 클라는 수신 후 다시 TypedArray로 감싼다

### 2.3 SORTIE (C→S, `/app/sortie`)

```ts
interface SortieCommand {
  from: number;   // 내 소유 admIndex
  to: number;     // from에 인접한 admIndex (전선 제한, README §4.2)
  ratio?: number; // 이번 출정에 보낼 병력 비율(0~1). UI 슬라이더 값. 생략 시 서버 기본값
}
```

- `amount`는 클라가 정하지 않는다. 서버가 `floor(troops[from] * ratio)`로 계산한다
- `ratio`는 신뢰하지 않는다 — 서버가 `[0.05, 1]`로 클램프하고, 비정상값(누락·NaN 등)이면 `CONFIG.SORTIE_RATIO`로 대체한다(README §4.2, §5 `SORTIE_RATIO`)
- 쿨다운 없음 — 병력 > 0이면 언제든 재전송 가능

### 2.3b LAUNCH_MISSILE (C→S, `/app/missile`)

동에 종속된 미사일 — 무작위 동에 스폰되고(`MISSILE_SPAWN_SEC` 주기), 그 동을 소유한 플레이어가 즉발로 발사한다. 발사하면 지정 원(중심+반경)에 조금이라도 겹치는 동이 모두 **중립화**(`ownerId=0`, `troops=0`)된다.

```ts
interface LaunchMissileCommand {
  center: [number, number]; // 조준 원 중심 [lng, lat]
  radius: number;           // 조준 원 반경(경위도 도 단위) — 폴리곤을 가진 클라가 계산
  hits: number[];           // center/radius 원에 겹치는 동 admIndex 목록 — 클라가 미리 계산해 보낸다
}
```

- `hits`는 클라가 폴리곤 기하로 계산해 보내지만 **신뢰하지 않는다**. 서버는 `radius`를 `MISSILE_MAX_RADIUS_DEG`로 클램프하고, 각 `hits[i]`의 centroid가 `center`에서 `radius + MISSILE_HIT_MARGIN_DEG` 이내인지 근사 검증한 것만 실제로 적용한다(서버엔 폴리곤이 없어 centroid 근접으로 근사)
- 발사에는 발사자가 소유한 동 중 미사일이 얹힌 동이 최소 1개 필요 — 어느 동의 미사일이 소모되는지는 클라가 지정하지 않는다(서버가 발사자 소유 미사일 동 중 아무거나 1개 선택)
- 개인 보유 상한 `MISSILE_MAX_PER_PLAYER`(기본 5) — 이미 상한이면 그 플레이어 동엔 새 미사일이 스폰되지 않는다(스폰 자체가 회피, 발사 시점 검증 아님)

### 2.4 ERROR (S→C, `/user/queue/error`)

SORTIE/LAUNCH_MISSILE이 검증 실패로 거부됐을 때만 요청자에게 전송. 월드 상태는 변하지 않으므로 DELTA는 오지 않는다.

```ts
interface ErrorMessage {
  code: "NOT_OWNER" | "NOT_ADJACENT" | "NO_TROOPS" | "ALREADY_FULL" | "NO_MISSILE";
  message: string; // 사용자 표시용 (아래 표의 한국어 문구)
  from: number;
  to: number;
}
```

| code | 발생 조건 | message (README/core.ts 기준) |
|---|---|---|
| `NOT_OWNER` | `ownerId[from] !== 요청자 holderId` | 본인 소유 동이 아닙니다. |
| `NOT_ADJACENT` | `to`가 `neighborIndex[from]`에 없음 | 인접한 동이 아닙니다. |
| `NO_TROOPS` | `floor(troops[from] * ratio) <= 0` | 출정 가능한 병력이 없습니다. |
| `ALREADY_FULL` | `to`가 내 동이고 `troopCap[to] - troops[to] <= 0`(이미 상한) | 이미 병력이 가득 찬 동입니다. |
| `NO_MISSILE` | 발사자 소유 동 중 미사일이 얹힌 동이 없음 | 발사할 미사일이 없습니다. |

- `to`가 내 동(증원)인데 상한 여유가 있지만 `amount`보다 적으면 거부하지 않는다 — 서버가 `amount`를 여유분(`troopCap[to] - troops[to]`)으로 **클램프해서 보낸다**(넘치는 병력이 출발조차 안 함, 초과분 소멸 방지).
- `NO_MISSILE`는 `from`/`to`가 의미 없어 둘 다 `-1`로 온다.

### 2.5 DELTA (S→C, `/topic/world`, 5Hz)

변경분만 브로드캐스트. 매 tick마다 dirty admIndex가 없으면 전송 생략(또는 빈 `cells`).

```ts
interface DeltaMessage {
  serverTimeMs: number;
  cells: [admIndex: number, ownerId: number, troops: number][]; // 변경된 동만
  newOrders: Order[];    // 이번 델타 구간에 새로 발주된 이동 유닛
  events: LogEvent[];    // 함락/침공/토벌 등 로그. **최신순**(newest-first) — 클라는 그대로 로그 앞에 붙인다
  missileAdd: number[];  // 이번 구간에 새로 스폰된 미사일 동
  missileRemove: number[]; // 이번 구간에 사라진 미사일 동(발사로 소모)
}

interface Order {
  from: number; to: number; amount: number;
  holderId: number;      // 파견 소유주 (도착 시 전투 판정 주체)
  departTick: number;    // 서버 tick(ms) — 유닛 이동 시작 시각
  arriveTick: number;    // 도착 예정 시각. 클라는 depart~arrive를 보간해 원을 그린다(README §4.4)
}

interface LogEvent {
  id: number;
  ts: number;      // 서버 벽시계(ms)
  message: string; // 예: "OO동 함락 — 중립 → 홍길동"
}
```

- 도착(arrive) 처리 결과 자체는 `cells`(도착 시점의 ownerId/troops 변화)로 반영되며, `newOrders`는 "출발"만 알린다 — 클라는 도착 시각(arriveTick)에 자체적으로 유닛을 소멸시키고 `cells` 갱신을 반영
- 환경 세력(E)의 행동도 동일한 `newOrders`/`cells` 경로로 온다. holder 목록에 없는 새 holderId는 오지 않음(E는 WELCOME에 이미 포함)

### 2.6 LEADERBOARD (S→C, `/topic/leaderboard`, 1Hz)

```ts
interface LeaderboardMessage {
  rows: { holderId: number; name: string; count: number }[]; // count 내림차순, 중립/E 제외
  envCells: number;   // 환경 세력 보유 동 수 (README §4.6 상한 게이지용)
  totalCells: number; // 전체 동 수 (점유율 계산용 분모)
}
```

- E는 순위표에 끼지 않는다(README §4.6, §8). `envCells`는 "전멸 위험도" 게이지가 아니라 단순 잔존 표시용

---

## 3. 시간 동기화

- 서버 타임스탬프가 기준. 클라는 WELCOME의 `serverTimeMs`와 수신 시각(로컬 `performance.now()` 또는 `Date.now()`)의 차이를 **1회 추정**해 `offset`으로 보관
- 이후 `Order.departTick`/`arriveTick`은 서버 시각 기준값이므로, 클라는 `로컬시각 + offset`으로 변환해 보간 진행률을 계산
- 재계산(재추정) 없음 — 목업/데모 규모(수십 명, 세션 30분 내)에서는 드리프트가 무시할 수준(plan.md §3)

---

## 4. HTTP 보조 엔드포인트 (WebSocket 외)

| 메서드/경로 | 용도 | 비고 |
|---|---|---|
| `GET /` 및 정적 자원 | 클라 빌드 서빙 | Spring이 단일 origin으로 서빙(CORS 회피), plan.md Day 5 |
| `GET /healthz` | 배포/헬스체크 | 200 고정 응답 |
| `POST /admin/config` | CONFIG 런타임 리로드 | plan.md §6 리스크 대응 — 서버 재시작 없이 밸런스 튜닝. 데모 전용, 인증 없음(내부용) |

- `POST /admin/config`는 `CONFIG` 객체(README §5)의 부분 갱신을 받아 즉시 반영하고, 다음 DELTA/WELCOME부터 새 값 적용. 스키마는 `Partial<typeof CONFIG>`

---

## 5. 참조 — 데이터 타입 원본

| 타입 | 근거 |
|---|---|
| `GameState`(서버 내부 상태) | [web/src/game/core.ts](../web/src/game/core.ts) — 서버 이식 시 1:1 대조 자료(plan.md §4) |
| `Order`, `Holder`, `DongStaticMeta`, `LogEntry` | [web/src/game/types.ts](../web/src/game/types.ts) |
| `CONFIG` 필드/기본값 | [web/src/config.ts](../web/src/config.ts), README §5 |
| 이 문서의 메시지 타입 그 자체 | [web/src/net/protocol.ts](../web/src/net/protocol.ts) — 클라가 실제로 쓰는 TS 선언 |
| "실서버가 어떻게 동작해야 하는가"의 참조 구현 | [web/src/net/localConnection.ts](../web/src/net/localConnection.ts) — 브라우저 내 목 서버. core.ts를 감싸 WELCOME/DELTA/ERROR/LEADERBOARD를 그대로 발신한다. 클램프 범위(SORTIE ratio 0.05~1) 등 이 문서에 없는 세부는 여기 기준 |
| 서버 실제 구현 | [server/](../server/) (Spring Boot/Kotlin) — `GameCore.kt`가 core.ts 1:1 이식, `README.md`에 진행 상황 |

> 목업 TS 코드(및 그 목 서버 `localConnection.ts`)가 사양의 1차 출처다. 이 문서와 코드가 어긋나면 **plan.md §6 "로직 이식 불일치" 리스크**에 해당하므로 코드를 기준으로 이 문서를 갱신한다.

## 6. 포위 귀속(encirclement capture) — 프로토콜 추가 없음

`GameCore.kt tickAnnex`(core.ts 1:1 이식, 목 서버가 먼저 구현했던 것을 실서버에도 포팅 완료). 한 플레이어 P가 다른 실제 플레이어 Q의 영역을 **자기 동만으로 완전히 둘러싼 채**(지도 바깥에 닿는 경로 없음) `ANNEX_HOLD_SEC`초(기본 5초) 연속 유지하면 그 영역 전체를 P가 흡수한다(병력 0으로 리셋). 별도 메시지 타입은 없다 — 기존 DELTA `cells`(소유권 변경)와 `events`(로그, `"{P}가 {Q} 포위 — N개 동 흡수"`) 경로를 그대로 쓴다. `GameLoop`이 매 tick(5Hz) 전체 플레이어에 대해 BFS로 판정하며, 25명 동시 접속 부하에서도 성능 문제 없음을 확인했다(`server/tools/smoke-test/annex-chaos-test.mjs`로 실제 발생까지 라이브 검증).

경계 동(borderMask, "동이 지도 바깥에 닿는지") 판정은 클라와 서버가 각자 `web/public/beopjeong-emd.geojson`에서 독립 계산하지만, 같은 파일·같은 topojson 위상 로직이라 결과가 일치한다(§4 데이터 파이프라인과 동일 원리).
