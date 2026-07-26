# server

동대장 시뮬레이터(PvPvE) 서버 — Spring Boot 4 · Kotlin · WebSocket/STOMP.
프로토콜은 [../docs/api-spec.md](../docs/api-spec.md), 게임 규칙은 [../README.md](../README.md), 일정은 [../docs/plan.md](../docs/plan.md) 참조.

## 실행

```bash
./gradlew bootRun          # http://localhost:8080, WS 엔드포인트 /ws (개발용 — 클라는 별도로 npm run dev)
./gradlew build             # 컴파일 + 테스트 + jar
./gradlew deployJar          # web/ 프로덕션 빌드까지 동봉한 단일 jar (아래 "배포" 참조)
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
├─ ws/          WebSocketConfig(STOMP) · JoinController · SortieController · MissileController · ConnectionRegistry
├─ loop/        GameLoop — 단일 스레드 tick(5Hz) + DELTA/LEADERBOARD 브로드캐스트
├─ persistence/ SnapshotService — 월드 저장/복구(data/world-snapshot.json, .gitignore 처리됨)
└─ admin/       AdminController — /healthz, /admin/config
```

**동시성 원칙**: World는 [GameLoop](src/main/kotlin/com/madcamp/server/loop/GameLoop.kt)의 단일 스레드에서만 mutate된다. JOIN/SORTIE 컨트롤러는 `GameLoop.runOnLoop{}`(응답 필요) 또는 `submitOnLoop{}`(fire-and-forget)로 위임할 뿐 World를 직접 건드리지 않는다 — 락 없이 레이스를 원천 차단. `tools/smoke-test/load-test.mjs`로 25명 동시 접속·명령 난사 상황에서 실측 검증함(아래 참조).

## 전국 경계 데이터

`resources/data/nationwide-dong.json`(약 1MB)은 `tools/data-gen/generate.mjs`(Node)가 `web/public/beopjeong-emd.geojson`(gisdeveloper 법정동 SHP를 mapshaper로 변환한 정적 자산, 5,065개)을 읽어 topojson 위상으로 인접 그래프·`border`(지도 바깥에 닿는 동인지, 포위 귀속 판정용)까지 뽑아낸 산출물이다.

**클라·서버가 정확히 같은 파일 하나(`web/public/beopjeong-emd.geojson`)를 같은 필터(`EMD_CD` 존재)·같은 순회 순서로 읽는다** — `web/src/data/loadDong.ts`는 fetch로, `generate.mjs`는 `readFileSync`로. admdongkor 같은 외부 API를 거치지 않고 정적 파일 하나를 공유하므로, admIndex 정렬이 어긋날 여지가 구조적으로 없다(예전엔 admdongkor 버전 드리프트를 걱정해야 했는데, 이 방식으로 그 문제 자체가 사라졌다).

**시군구/시도명**(`sggnm`/`sidonm`)은 `beopjeong-emd.geojson`엔 코드(`EMD_CD`)만 있고 이름이 없어서, `tools/data-gen/generate-sgg-names.mjs`가 admdongkor의 sgg/sido 레벨에서 이름만 뽑아 `web/public/sgg-sido-names.json`(작은 code→name 딕셔너리, 클라·서버 공유)으로 미리 구워둔다. `generate.mjs`/`loadDong.ts` 둘 다 이 파일을 읽어 채운다. **주의**: admdongkor의 "latest"를 그대로 쓰면 안 된다 — 법정동 원본(2023-07-29 스냅샷)과 시군구/시도 코드 체계가 달라(그 사이 전북특별자치도 출범 등 행정구역 개편) 실제로 시도 3개·시군구 47개가 매칭 실패했다. 그래서 원본과 같은 시기 스냅샷(`20230701`)으로 고정했다(스크립트 상단 `NAME_SNAPSHOT_VERSION`).

데이터를 다시 뽑으려면(원본 SHP가 갱신됐을 때 등):

```bash
cd tools/data-gen
node generate-sgg-names.mjs   # web/public/sgg-sido-names.json 갱신 (이름 코드 체계가 바뀌었을 때만 재실행 필요)
node generate.mjs             # resources/data/nationwide-dong.json 갱신
```

실행 결과 인접 차수 0(섬·월경지)인 동이 62개 있다(인천 도서 지역, 여수 등) — README §6 리스크 그대로. 현재는 그대로 두어 해당 동은 고립 상태다(공격 불가). 페리 엣지 수동 추가는 아직 미적용(README 부록A 미정 항목).

## 배포 (plan.md Day 5 — 단일 origin 서빙)

```bash
./gradlew deployJar
java -jar build/libs/server-*-deploy.jar
```

`deployJar`는 별도 Gradle 태스크로, `web/`을 `npm run build`로 프로덕션 빌드한 뒤 그 결과물(`web/dist`)을 jar 안 `/static`으로 동봉한다. 평소 쓰는 `bootRun`/`build`/`bootJar`에는 전혀 안 걸려 있어(서버만 만지는 동안엔 npm 빌드가 안 돌고, Node 없는 머신에서도 평소 개발이 된다), 배포 직전에만 명시적으로 돌리면 된다. 실행하면 `:8080` 하나로 API·WebSocket·화면이 전부 나온다(같은 origin이라 CORS 문제 없음) — Playwright로 실제 브라우저에서 `http://localhost:8080` 접속→JOIN→렌더까지 검증 완료.

## 테스트 도구 (`tools/`)

서버를 `./gradlew bootRun`(또는 `deployJar`로 만든 jar)으로 띄운 상태에서:

```bash
cd tools/smoke-test
npm install
node smoke.mjs                  # 기본 라운드트립: JOIN→WELCOME, 잘못된 SORTIE→ERROR, 정상 SORTIE(ratio 포함)→DELTA→함락+토벌 로그
node reconnect-test.mjs         # 같은 토큰 재접속=holderId·영토 유지 / 가짜 토큰=신규 참가자 처리
node auto-reconnect-test.mjs    # stompjs 자동 재연결(reconnectDelay)까지 포함해 holderId 유지되는지 검증
node load-test.mjs 25 8         # N명 동시 접속(기본 25) × 초(기본 8) 동안 SORTIE 난사 → 서버 생존·월드 상태 불변식 확인
node missile-test.mjs           # 미사일: 미보유 발사 거부(NO_MISSILE), 스폰 브로드캐스트 확인
node missile-launch-forced.mjs  # /admin/config로 생산 속도를 잠깐 올려 발사→중립화까지 결정적으로 재현
node env-cluster-check.mjs      # E 다중 클러스터가 실제로 여러 곳에 흩어져 스폰되는지 확인
node annex-chaos-test.mjs       # 여러 명 동시 국소 확장 → 포위 귀속(흡수)이 실제로 발생하는지 관찰
```

`load-test.mjs`는 25명·8초·약 2,300건 SORTIE 기준으로 healthz 정상, 클라이언트측 WS/STOMP 오류 0건, 월드 상태 불변식(모든 동의 ownerId가 0~255 유효 범위) 위반 0건을 확인했다(Day 4 "동시성 검증"에 대응). `annex-chaos-test.mjs`는 8명이 45초 동시 확장하는 시나리오에서 포위 흡수 264건이 실제로 발생함을 확인했다 — 매 tick 전체 플레이어에 대해 BFS 판정이 도는데도 성능 문제 없음.

## plan.md 대비 진행 상황

| Day | 항목 | 상태 |
|---|---|---|
| 1 | 프로젝트 셋업, STOMP, 전국 경계 데이터 로드 | 완료 |
| 2 | 월드 tick(생산·SORTIE 검증·Order·전투), DELTA | 완료 |
| 3 | E AI, 게스트 세션/재접속, 시작 동 배정 | 완료 |
| 4 | 동시성 검증(다인 플레이테스트), 재접속 엣지 케이스 | 완료 — 자동화 부하/재접속 테스트로 검증(위 "테스트 도구") |
| 5 | 배포(정적 서빙), 스냅샷 저장/복구 | 완료 — `deployJar`로 실제 단일 jar 배포까지 브라우저 검증 |
| 6 | 프리즈, 리허설 | 팀 차원 활동 — 코드로 대체 불가. 실제 청중 앞 리허설·LAN 폴백 리허설은 남아 있음 |

## 클라(web/) 연동 — StompConnection으로 실서버 연결 완료

클라의 `Connection` 인터페이스 실서버 구현체 `web/src/net/stompConnection.ts`를 추가하고, `App.tsx`의 기본 연결을 이걸로 교체했다(`VITE_USE_LOCAL_MOCK=1`로 이전 브라우저 내 목 서버(`localConnection`)로도 되돌릴 수 있게 스위치는 남겨둠). 클라가 먼저 구현해둔 `localConnection.ts`(목 서버)가 사실상 "실서버가 어떻게 동작해야 하는가"의 참조 구현이라, 서버도 거기 맞춰 검증·조정했다:

- `SortieCommand.ratio`(출정 비율 슬라이더) 반영 — 서버가 `[0.05, 1]`로 클램프, 비정상값은 `CONFIG.SORTIE_RATIO`로 대체
- `WELCOME.config`에 `ENV_HOLDER_ID` 포함 — 클라 `CONFIG` 객체 그대로 매칭(`@JsonProperty`로 SCREAMING_SNAKE_CASE 유지)
- 환경 세력(E) holder 이름 `"야만인"`, `paletteIdx = 6`(클라 `ENV_PALETTE_IDX`)
- 플레이어 `paletteIdx`는 클라 `PLAYER_PALETTE_IDXS = [1,2,3,4,5]`와 동일한 5슬롯 순환
- 함락 로그에 토벌 보너스 표기(`"... (+10 토벌)"`) — `core.ts resolveArrival`과 문구 통일
- `DELTA.events`를 최신순(newest-first)으로 전송 — `worldView.ts applyDelta`의 prepend 가정과 일치
- **시간 동기화**(api-spec.md §3): `StompConnection`이 WELCOME의 `serverTimeMs`로 offset을 1회 계산해, 서버가 보낸 `Order.departTick/arriveTick`(epoch ms)을 클라 rAF 시간축(`performance.now()`)으로 변환한다 — `worldView`/`MapView`는 이 차이를 몰라도 되게 경계(Connection)에서만 처리
- **admIndex 정렬**: 클라·서버가 같은 정적 GeoJSON 파일(`web/public/beopjeong-emd.geojson`)을 같은 순서로 읽어 admIndex를 매기므로 구조적으로 일치한다(위 "전국 경계 데이터" 참조)

**실제 브라우저(Playwright, Chrome)로 검증**: `npm run dev`(5173) + `./gradlew bootRun`(8080) 조합, 그리고 `deployJar`로 만든 단일 jar(8080, 같은 origin) 둘 다에서 접속→JOIN→WELCOME 반영→지도 렌더→좌클릭 선택까지 콘솔 에러 없이 동작 확인.

## 클라 추가 기능 3종 — 미사일 / 포위 귀속 / E 다중 클러스터

클라가 이후 추가한 기능들을 서버에도 이식·검증했다(둘 다 core.ts와 1:1):

- **미사일**: 전국 무작위 동에 스폰(`MISSILE_SPAWN_SEC` 주기, 맵 전체 상한 `MISSILE_MAX_TOTAL`·개인 상한 `MISSILE_MAX_PER_PLAYER`) → 그 동을 소유한 플레이어가 즉발로 발사 → 지정 원(중심+반경)에 겹치는 동 전부 중립화. `MissileController.kt`가 클라가 계산해 보낸 반경·타격 목록을 신뢰하지 않고 서버가 다시 검증(centroid 근접 근사, 폴리곤은 서버에 없음).
- **포위 귀속(encirclement)**: 위 §6(api-spec.md) 참조. `GameCore.kt tickAnnex` — 서버가 직접 이식. 별도 프로토콜 없이 기존 DELTA 경로 재사용.
- **E 다중 클러스터**: `EnvAi.kt spawn`을 최원점(farthest-point) 샘플링으로 다시 짜서 `ENV_CLUSTER_COUNT`(기본 3)개 무리를 전국에 흩뿌린다. 실측: 강화도·울릉도·제주 3곳에 분산 스폰 확인(`env-cluster-check.mjs`). 클라의 "플레이어 근처 첫 씨앗" 로직은 뺐다 — 서버는 아무도 접속하기 전에 스폰하므로 기준 삼을 플레이어가 없다(README §4.6 "외곽 스폰"에 맞춰 첫 씨앗도 outer-score 최고점).

이 세 기능 모두 25명 동시 부하(`load-test.mjs`)·45초 8명 동시 확장(`annex-chaos-test.mjs`)에서 서버가 죽거나 느려지지 않는 것까지 확인됐다.

## 궤멸 후 자동 재시작 (버그 수정)

실사용 중 발견: 미사일이 플레이어의 유일한 동을 직격하면 소유 동이 0개가 되고, SORTIE는 내 소유 동에서만 가능해서 이후 아무것도 할 수 없는 영구 탈락 상태가 됐다. README/plan.md 어디에도 "영구 제거" 규칙은 없고 지속형 캔버스 컨셉이므로, **소유 동이 0개가 된 실제 플레이어에게는 매 tick 새 시작 동을 자동 배정**한다(`GameCore.kt respawnEliminatedPlayers`, 신규 참가자와 같은 `StartCellAssigner`를 domain 패키지로 공유해서 재사용). 별도 프로토콜 없이 기존 DELTA `cells`/`events`(`"{닉네임}님이 궤멸 후 {동}에서 재시작합니다."`) 경로 그대로. E(255)는 예외 — README §4.6대로 소탕되면 재스폰 없음.

클라(`core.ts`/`localConnection.ts`)에도 동일 로직을 이식해 목 서버도 같은 규칙을 따르고, `worldView.ts`가 "소유 동 0개였다가 다시 생김"을 감지하면 `App.tsx`가 토스트로 안내한다.

실서버에 실제 시나리오(갓 접속한 플레이어가 미사일 직격으로 동 1개→0개)를 그대로 재현해 다음 tick 안에 자동 재시작되는 것까지 확인했다(`respawn-test.mjs`).

## 아직 안 한 것 / 다음에 할 것

- 계급(Rank) 계산은 구현했지만 어떤 메시지로도 아직 안 내려줌(api-spec.md에 계급 필드 없음 — 필요해지면 LEADERBOARD나 별도 메시지에 추가)
- 실제 청중 다수가 동시에 접속하는 Day 6 리허설(로컬 LAN 핫스팟 + `host:true` 폴백 포함) — 이건 실제 사람과 네트워크가 필요해 코드로 못 끝냄
- 클라우드 VM/교내 서버로의 실제 배포(현재는 로컬에서 `deployJar` 산출물 실행까지만 검증) 및 도메인/포트 확정
- 12색 팔레트(현재 5슬롯) 확장 여부 — 5명 넘게 동시 플레이하면 색이 겹침(README 부록A 미정 항목, 클라 쪽 결정 필요)
