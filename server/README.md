# server

구청장 시뮬레이터 서버 — Spring Boot 4 · Kotlin · WebSocket/STOMP. 게임 로직의 **권위**이며, 클라는 렌더러+입력 전송기다.
프로토콜은 [../docs/api-spec.md](../docs/api-spec.md), 게임 규칙은 [../README.md](../README.md), 아키텍처는 [../docs/architecture.md](../docs/architecture.md) §3 참조. 최종 진실은 코드다.

## 실행

```bash
./gradlew bootRun          # http://localhost:8080 — WS /ws, REST /api·/ranking·/admin (개발용)
./gradlew build            # 컴파일 + 테스트 + jar
./gradlew deployJar        # web/ 프로덕션 빌드까지 동봉한 단일 jar (아래 "배포")
```

- **JDK 17+** 필요(툴체인 고정 안 함 — `./gradlew`를 실행하는 JDK를 그대로 씀). 첫 실행 시 Gradle 배포판(9.5.1)을 내려받는다.
- 스택: **Kotlin 2.3 · Spring Boot 4.1 · Jackson 3(`tools.jackson.*`)**. 의존성: websocket · data-jpa(H2) · data-redis · firebase-admin.
- 계정 DB는 H2 파일(`server/data/users`, 자동 생성). Redis(:6379)는 랭킹 전용 — 없으면 랭킹만 조용히 비활성(게임은 정상). `REDIS_HOST` 환경변수로 호스트 지정.

### 구글 로그인 설정 (선택 — 없어도 게스트 플레이는 그대로 동작)

로그인은 **클라·서버 양쪽에 자격 증명 파일이 있어야** 켜진다. 둘 다 git에 없으므로, 받아온 저장소를 그대로 실행하면 로그인만 비활성 상태가 된다("로그인이 고장난 것"이 아니다).

| 파일 | 내용 | 없을 때 |
|---|---|---|
| `web/.env.local` | Firebase **웹** 설정(`web/.env.example` 복사해 채움) | 로그인 버튼 비활성 + 안내 문구 |
| `server/secrets/firebase-service-account.json` | Firebase **Admin** 서비스 계정 키 | 서버가 토큰을 전부 거부(기동 시 warn) |

- 웹 설정값은 빌드 결과 JS에 실려 나가는 공개 정보라 공유 제약이 없다.
- **서비스 계정 키는 진짜 비밀**(개인키 포함)이다. `server/.gitignore`의 `/secrets/`로 막아두었으니 절대 커밋하지 말 것. 경로는 `app.firebase.service-account-path`(기본 `secrets/firebase-service-account.json`).

## 구조

```
src/main/kotlin/com/madcamp/server/
├─ ws/        WebSocketConfig(STOMP /ws) · 컨트롤러(Join·Sortie·March·MultiSortie·Missile·Nuke·Airdrop·
│             AttackQueue·Restart · Lobby·Room · FriendInvite) · dto/Messages · ConnectionRegistry ·
│             SessionEventListener(연결 해제 정리) · WelcomeAssembler · RoomBroadcaster
├─ game/      Room(LOBBY/PLAYING/ENDED 상태기계 + 방별 accumulator) · RoomManager(상한: 방 32·동시 8·인원 8)
├─ loop/      GameLoop(단일 스레드 5Hz tick + 라운드 종료 판정 + DELTA/LEADERBOARD) · LoopMetrics
├─ domain/    World(core.ts GameState 대응) · GameCore(순수 로직 이식) · PlayerAi(AI 채우기·확장·증원) ·
│             StartCellAssigner(서울 BFS 본토·제주 제외 스폰) · Types · EnvAi(사장 — 미사용)
├─ config/    GameConfig(README §8 CONFIG 미러, WELCOME으로 배포) · ConfigService · HolderIds · Palette · CorsConfig
├─ session/   SessionService(토큰 세션·재접속 복구 joinOrRestore/roomOf)
├─ auth/      FirebaseAuthService(구글 토큰 검증) · AccountService · AppUser/Friendship(JPA) ·
│             PresenceRegistry · AccountController · FriendController
├─ ranking/   RankingService(Redis hof:wins ZSET) · RankingController(GET /ranking/top)
├─ admin/     AdminController(/healthz · /admin/metrics · /admin/config)
└─ data/      BoundaryDataLoader · MapCatalog — resources/data/kr-sgg-cells.json 로드
```

**동시성 원칙**: 모든 `World` mutate·방 멤버십 변경·라운드 전환은 [GameLoop](src/main/kotlin/com/madcamp/server/loop/GameLoop.kt)의 **단일 스레드 executor**에서만 일어난다. 컨트롤러는 `runOnRoom{}`/`submitOnRoom{}`(월드 액션)·`submitRoomTask{}`(멤버십)로 위임할 뿐 World를 직접 건드리지 않는다 — 락 없이 레이스를 원천 차단.

**월드는 휘발성**이다. 방·월드는 `RoomManager` 인메모리 맵에만 있고 라운드마다 새로 만든다. 스냅샷 영속(`persistence`/`SnapshotService`)은 **제거됐다**(지속 데이터는 H2 계정·Redis 랭킹뿐).

## 주요 엔드포인트

- **STOMP** `/ws`(SockJS): 룸 스코프 토픽 `/topic/room/{id}/world|leaderboard|state`, 로비 `/topic/rooms`, 개인 `/user/queue/{welcome,error,roomJoined,...}`. 명령은 `/app/...`. 전체 목록·페이로드는 [api-spec.md](../docs/api-spec.md).
- **REST**: `POST /api/account/me`·`/api/account/nickname`, `POST /api/friends/{search,request,respond,list}`, `GET /ranking/top?limit=`, `GET /healthz`, `GET /admin/metrics`, `GET|POST /admin/config`(부분 갱신·즉시 반영, 현재 인증 없음).

## 경계 데이터 (시/군/구)

- 서버는 런타임에 인접을 계산하지 않는다. `resources/data/kr-sgg-cells.json`(시/군/구 **250개**, `sourceVersion "admdongkor sgg 20230701"`)을 `BoundaryDataLoader`가 읽는다 — 인접(`neighbors`)·경계(`border`)·반경(`radiusDeg`)이 **전처리로 포함**돼 있다.
- 이 파일은 `server/tools/data-gen`이 `web/public/kr-sgg.geojson`에서 오프라인으로 굽는다. 클라·서버가 같은 셀 집합을 같은 순서로 읽어 `admIndex`가 구조적으로 일치한다.
- `MapCatalog.DEFAULT = "kr-sgg"`, `RESOURCE_PATHS`엔 `kr-sgg`만 등록. 구 법정동 지도(`nationwide-dong.json`, ~5065동)는 리소스에 남아 있으나 **로드되지 않는다**(`BoundaryDataLoader`에서 비활성).

## 배포 (단일 오리진)

```bash
./gradlew deployJar
java -jar build/libs/server-*-deploy.jar     # :8080 하나로 웹 정적 + REST + WS (같은 오리진, CORS 불필요)
```

`deployJar`는 `web/`을 `npm run build`한 결과(`web/dist`)를 jar 안 `/static`으로 동봉한다. 평소 `bootRun`/`build`/`bootJar`엔 안 걸려 있어(서버만 만지는 동안 npm 빌드가 안 돌고 Node 없는 머신에서도 개발 가능), 배포 직전에만 명시적으로 돌린다.
프로덕션은 Docker 3-스테이지 이미지 → GHCR → VM(`deploy/docker-compose.yml`, watchtower 자동 갱신 + Redis). 상세는 [architecture.md](../docs/architecture.md) §7.

## 테스트 도구 (`tools/`)

`./gradlew bootRun`(또는 deployJar jar)으로 서버를 띄운 상태에서 `tools/smoke-test`의 STOMP 클라 스크립트로 검증한다(`npm install` 후 `node <script>.mjs`): 기본 라운드트립(JOIN→WELCOME→SORTIE→DELTA), 재접속(같은 토큰=holder 유지), 부하(N명 동시 SORTIE 난사 → 상태 불변식), 색상 동기화(늦게 합류한 플레이어의 paletteIdx가 DELTA.newHolders로 즉시 전파되는지) 등. `server/tools/data-gen`은 경계 데이터 재생성용.

> 참고: 예전 환경 세력(E) 관련 스크립트(`env-*`)는 E가 AI 플레이어로 대체되며 **의미가 없어졌다**(하위 호환용 잔존).
