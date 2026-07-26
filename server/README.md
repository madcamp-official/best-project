# server

동대장 시뮬레이터(PvPvE) 서버 — Spring Boot 4 · Kotlin · WebSocket/STOMP.
프로토콜은 [../docs/api-spec.md](../docs/api-spec.md), 게임 규칙은 [../README.md](../README.md), 일정은 [../docs/plan.md](../docs/plan.md) 참조.

## 실행

```bash
./gradlew bootRun          # http://localhost:8080, WS 엔드포인트 /ws
./gradlew build             # 컴파일 + 테스트 + jar
```

JDK 17+ 필요(툴체인 고정 안 함 — `./gradlew`를 실행하는 JDK를 그대로 씀). 첫 실행 시 Gradle 배포판(9.5.1)을 인터넷에서 내려받는다.

- `GET /healthz` → `ok`
- `GET /admin/config` → 현재 CONFIG
- `POST /admin/config` → CONFIG 부분 갱신(JSON body, 재시작 없이 즉시 반영)
- STOMP: `/app/join`, `/app/sortie` 수신 / `/user/queue/welcome`, `/user/queue/error`, `/topic/world`, `/topic/leaderboard` 발신 — 필드는 [api-spec.md](../docs/api-spec.md) 참조

## 구조

```
src/main/kotlin/com/madcamp/server/
├─ config/      GameConfig(README §5 CONFIG) · ConfigService(런타임 리로드)
├─ domain/      World(core.ts GameState 대응) · GameCore(순수 로직 이식) · EnvAi(§4.6) · Types
├─ data/        BoundaryDataLoader — resources/data/nationwide-dong.json 로드
├─ session/     SessionService — 게스트 토큰/재접속/시작 동 배정
├─ ws/          WebSocketConfig(STOMP) · JoinController · SortieController · ConnectionRegistry
├─ loop/        GameLoop — 단일 스레드 tick(5Hz) + DELTA/LEADERBOARD 브로드캐스트
├─ persistence/ SnapshotService — 월드 저장/복구(data/world-snapshot.json, .gitignore 처리됨)
└─ admin/       AdminController — /healthz, /admin/config
```

**동시성 원칙**: World는 [GameLoop](src/main/kotlin/com/madcamp/server/loop/GameLoop.kt)의 단일 스레드에서만 mutate된다. JOIN/SORTIE 컨트롤러는 `GameLoop.runOnLoop{}`(응답 필요) 또는 `submitOnLoop{}`(fire-and-forget)로 위임할 뿐 World를 직접 건드리지 않는다 — 락 없이 레이스를 원천 차단.

## 전국 경계 데이터

`resources/data/nationwide-dong.json`(약 800KB)은 `tools/data-gen/generate.mjs`(Node)가 admdongkor + topojson으로 미리 뽑아둔 산출물이다. web/src/data/loadSeoulDong.ts와 같은 방식(위상 기반 인접 그래프, polylabel 라벨 좌표)을 시도 필터 없이 전국(3,558동)에 적용했다.

데이터를 다시 뽑으려면(admdongkor 버전 갱신 등):

```bash
cd tools/data-gen
npm install
node generate.mjs   # resources/data/nationwide-dong.json 갱신
```

실행 결과 인접 차수 0(섬·월경지)인 동이 54개 있었다(인천 도서 지역, 여수 등) — README §6 리스크 그대로. 현재는 그대로 두어 해당 동은 고립 상태다(공격 불가). 페리 엣지 수동 추가는 아직 미적용(README 부록A 미정 항목).

## 스모크 테스트

`tools/smoke-test/smoke.mjs`가 실제 STOMP 라운드트립(JOIN→WELCOME, 잘못된 SORTIE→ERROR, 정상 SORTIE→DELTA→함락 로그)을 검증한다. 서버를 띄운 상태에서:

```bash
cd tools/smoke-test
npm install
node smoke.mjs
```

## plan.md 대비 진행 상황

| Day | 항목 | 상태 |
|---|---|---|
| 1 | 프로젝트 셋업, STOMP, 전국 경계 데이터 로드 | 완료 |
| 2 | 월드 tick(생산·SORTIE 검증·Order·전투), DELTA | 완료 |
| 3 | E AI, 게스트 세션/재접속, 시작 동 배정 | 완료 |
| 4 | 동시성 검증(다인 플레이테스트), 재접속 엣지 케이스 | 미착수 — 실제 다인 부하 테스트 필요 |
| 5 | 배포(정적 서빙 이미 설정, 클라우드/교내 서버 배포는 미착수), 스냅샷 저장/복구 | 스냅샷 완료, 배포 미착수 |
| 6 | 프리즈, 리허설 | 미착수 |

## 클라(web/) 프로토콜 정합성

클라 담당이 `web/src/net/`(`protocol.ts`·`connection.ts`·`localConnection.ts`)에 STOMP 실서버와 같은 인터페이스로 동작하는 **브라우저 내 목 서버**를 이미 구현해뒀다. 이게 사실상 "실서버가 어떻게 동작해야 하는가"의 참조 구현이라, 이 서버를 그 계약에 맞춰 검증·조정했다:

- `SortieCommand.ratio`(출정 비율 슬라이더) 반영 — 서버가 `[0.05, 1]`로 클램프, 비정상값은 `CONFIG.SORTIE_RATIO`로 대체(`localConnection.ts sendSortie`와 동일 규칙)
- `WELCOME.config`에 `ENV_HOLDER_ID` 포함 — 클라 `CONFIG` 객체 그대로 매칭(`@JsonProperty`로 SCREAMING_SNAKE_CASE 유지)
- 환경 세력(E) holder 이름 `"야만인"`, `paletteIdx = 6`(클라 `ENV_PALETTE_IDX`) — 렌더링 시 클라 팔레트와 어긋나지 않게
- 플레이어 `paletteIdx`는 클라 `PLAYER_PALETTE_IDXS = [1,2,3,4,5]`와 동일한 5슬롯 순환
- 함락 로그 메시지에 토벌 보너스 표기(`"... (+10 토벌)"`) — `core.ts resolveArrival`과 문구 통일
- `DELTA.events`를 최신순(newest-first)으로 전송 — `worldView.ts applyDelta`가 그 순서를 가정하고 그대로 prepend함

남은 정합성 이슈는 없는지 실제 `StompConnection` 붙일 때 다시 한번 라운드트립 확인 필요.

## 아직 안 한 것 / 다음에 할 것

- 클라의 `localConnection`을 실제 `StompConnection`으로 교체하는 작업(클라 담당 몫) — `Connection` 인터페이스는 이미 있으므로 구현체만 추가하면 됨
- 계급(Rank) 계산은 구현했지만 어떤 메시지로도 아직 안 내려줌(api-spec.md에 계급 필드 없음 — 필요해지면 LEADERBOARD나 별도 메시지에 추가)
- 클라 정적 빌드를 `src/main/resources/static/`에 넣는 실제 빌드 파이프라인(Day 5) 미구성
- 다인 동시 접속 부하/경합 실측(Day 4) 안 해봄 — 지금까지는 단일 클라이언트 스모크 테스트만
