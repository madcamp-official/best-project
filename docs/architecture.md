# 아키텍처

> 게임 규칙·데이터·상수의 원본 사양은 [README.md](../README.md), 프로토콜 상세는 [api-spec.md](./api-spec.md), 코드 컨벤션은 [convention.md](./convention.md).
> 이 문서는 **"코드가 어떻게 짜여 있는지"**(계층·모듈·데이터 흐름·배포)를 다룬다. 최종 진실은 코드다.

---

## 1. 전체 구도

```
┌── 브라우저 (web/, React+Vite+MapLibre) ─────────────┐        ┌── 서버 (server/, Spring Boot 4·Kotlin) ──────┐
│  UI(Zustand) · MapView(MapLibre) · worldView(사본) │  STOMP │  ws/ 컨트롤러 → GameLoop(단일 스레드 5Hz)    │
│  net/Connection ───── /app/... 명령 ──────────────▶│◀──────▶│  domain/GameCore(권위 시뮬레이션) · Room 다중  │
│                ◀──── WELCOME/DELTA/LEADERBOARD ────│  /topic│  auth(H2) · ranking(Redis) · admin           │
└─────────────────────────────────────────────────────┘        └───────────────────────────────────────────────┘
        │  REST /api·/ranking (계정·친구·명예의 전당)                        │
        └──────────────────────────────────────────────────────────────────┘
```

- **서버가 권위**: 모든 게임 상태·규칙은 서버 `GameLoop`가 소유·실행. 클라는 **렌더러 + 입력 전송기**다 — 로컬에서 규칙을 돌리지 않는다.
- **도메인 코어 1:1 미러**: `web/src/game/core.ts`(TS) ↔ `server/.../domain/GameCore.kt`(Kotlin)를 사양서 삼아 동일 로직으로 이식. 둘 다 순수 함수 + 주입 시계라 클라 목 서버가 서버와 같은 규칙을 돌릴 수 있다.
- **개발 경로 2종**: 실서버(STOMP) 또는 브라우저 내 목 서버(`localConnection`, `VITE_USE_LOCAL_MOCK=1`). 둘 다 같은 `Connection` 계약을 구현하므로 스위치 하나로 교체된다.

---

## 2. 클라이언트 (`web/src`)

### 2.1 계층 (폴더 = 책임)

| 폴더 | 책임 |
|---|---|
| `game/` | 순수 게임 로직 `core.ts` + 공유 타입 `types.ts` — **서버 이식 대상**. React/Map/시계 의존 금지 |
| `net/` | `connection.ts`(인터페이스) + `protocol.ts`(메시지 타입) + `stompConnection.ts`(실서버) + `localConnection.ts`(목 서버) |
| `world/` | `worldView.ts` — 서버 상태 사본. WELCOME/DELTA 반영 계층(게임 로직 없음) |
| `data/` | `loadMapData.ts`(경계·인접·아크 로딩), `labelPoint.ts`, `sggSpecialty.ts` |
| `map/` | `MapView.tsx` — MapLibre 렌더 전용. `world`를 읽고 `connection`으로 입력 전송 |
| `store/` | `uiStore.ts`(Zustand) — UI 상태만(phase·선택 셀·순위표 요약 등) |
| `ui/` | 로비·대기실·결과·HUD 등 프레젠테이션 컴포넌트 |
| `auth/` | `firebase.ts`(구글 로그인), `api.ts`(계정·친구 REST) |

### 2.2 상태 계층 분리 (핵심 제약)
- **월드 상태**(250셀 typed array, `GameState`)는 React/Zustand에 **절대 넣지 않는다** — React 밖 싱글턴 `world`(`world/worldView.ts`)에 유지하고, `dirty` 변경분만 rAF로 MapLibre에 반영.
- **UI 상태**(선택 셀, 패널 열림, phase 등 소량)만 `uiStore`.
- `MapView`의 MapLibre 인스턴스는 `useRef` + `useEffect`로 **1회만 생성** — 이후 React 렌더가 지도를 직접 건드리지 않고, 모든 갱신은 명령형(`setFeatureState`/`setData`).

### 2.3 App phase 상태기계 (`App.tsx` + `uiStore`)
```
loading → (목업) join / (실서버) authChoice → lobby → room → ready → results → (lobby)
                                                                    error = 로드 실패
```
- 부트스트랩 `useEffect`에서 `isMock`으로 분기: 목업은 지도를 즉시 로드 후 `LocalConnection`, 실서버는 `StompConnection` 생성 후 WELCOME까지 지도 로드를 미룬다.
- 서버→클라 콜백(`onWelcome`/`onDelta`/`onError`/`onLeaderboard`/`onRoomList`/`onRoomJoined`/`onRoomState`/`onRoundEnd`/`onFriendPresence`/`onInvite`/`onConnectionChange`)을 전부 배선해 store·phase를 갱신한다.
- `MapView`는 `prepared`(지도) + `connection`이 있을 때만 마운트. 각 phase는 자기 오버레이 화면(`LobbyScreen`/`RoomWaitScreen`/`ResultsOverlay`/`Hud` 등)을 렌더.

### 2.4 렌더링 파이프라인 (`MapView.tsx`)
- 빈 스타일 + CARTO 다크 raster 베이스맵. `maxBounds`로 한국 밖 이탈 방지. maplibre 워커 URL을 명시 지정(프로덕션 번들 404 방지).
- 소스 `dong`(`promoteId: "admIndex"`) feature-state: `owner`(=holder의 **paletteIdx**), `mine`(더 진한 채움), `hover`/`selected`/`flash`/`enclosed`/`aim`. 소스 `arcs`: `frontier`(bool) + `color`(테두리 hex).
- 레이어(대표): 채움 `dong-fill` · 국경선 `frontier`/`frontier-glow` · 정적 경계 `admin-sgg/sido-boundary` · 라벨 `dong-name/troop-badges`(줌≥7) ↔ 저줌 `owned-dots`/`player-labels`(줌<7) · 유닛 `unit-circle`/`airdrop-unit-icon`(삼각형) · 마커 `missiles`/`nuke-silos`/`attack-queue` · 조준/방어막/폭발/화살표 오버레이.
- rAF 루프 하나가 WASD/줌 이동, `drainDirty` 배치 리페인트, 함락 플래시·포위 펄스·유닛 보간·미사일/전술핵 조준·공수 2단 조준·폭발 충격파·방어막 돔·순위 요약(250ms 스로틀)을 모두 처리.

### 2.5 도메인 코어 (`game/core.ts`)
- `GameState` 하나에 모든 상태(typed array + `holders`/`orders`/`attackQueue`/`shieldUntil`/`nuke*`/`playerPaletteBag` 등)를 담고 순수 함수가 인자로 받아 변경.
- 시스템별 진입 함수: 생산 `tickProduction` · 출정 `trySortie`/`tryMultiSortie` · 이동/전투 `tickOrders`/`resolveArrival`/`tickOrderClashes` · 행군 `tryMarch` · 공격 큐 `toggleAttackTarget`/`tickAttackQueue` · 보급 `tickSupply` · 미사일 `trySpawnMissile`/`launchMissile` · 전술핵 `launchNuke` · 공수 `tryAirdrop`/`resolveAirdrop` · 방어막 `applyShield` · 포위 `tickAnnex` · 재시작 `respawnPlayer` · 순위/계급 `getLeaderboard`/`dominationHolder`/`computeRank` · AI `fillAiPlayers`/`tickPlayerAi` · 스폰 `mainlandFromSeoul`/`pickStartCell`.
- 클라 실플레이에서는 이 중 **읽기 전용 쿼리(순위·계급·색)만** `worldView`가 재사용하고, 시뮬레이션 자체는 서버가 돌린다. 목 서버(`localConnection`)만 전체 `tick`을 돌린다.

---

## 3. 서버 (`server/src/main/kotlin/com/madcamp/server`)

패키지: `ws · game · loop · domain · config · session · auth · ranking · admin · data`. (`persistence`는 **없다** — §6.)

### 3.1 결정사항
| 항목 | 선택 |
|---|---|
| 언어/프레임워크 | Kotlin 2.3 · Spring Boot 4.1 · Jackson 3(`tools.jackson.*`) |
| 월드 모델 | **다중 방**(`RoomManager`의 `Map<roomId, Room>`), 각 방 = 독립 월드/라운드 |
| 동시성 | 락 없음 — 단일 스레드 executor(`GameLoop`)가 모든 월드·멤버십·라운드 전환을 실행 |
| 월드 영속 | **없음(휘발성)** — 방·월드는 인메모리, 라운드마다 새 월드 |
| 인증 | Firebase(구글) ID 토큰 검증(요청마다). 별도 JWT 계층 없음 |
| 지속 데이터 | 계정·친구 = H2 파일 DB(JPA) · 랭킹 = Redis ZSET |

### 3.2 모듈

| 패키지 | 핵심 클래스 | 역할 |
|---|---|---|
| `ws` | `WebSocketConfig`, `*Controller`, `dto/Messages`, `ConnectionRegistry`, `SessionEventListener`, `WelcomeAssembler`, `RoomBroadcaster` | STOMP 엔드포인트 `/ws`(SockJS), 명령 수신·검증, 룸 스코프 브로드캐스트, principal→방 라우팅, 연결 해제 정리 |
| `game` | `Room`, `RoomManager` | 방 상태기계(`LOBBY/PLAYING/ENDED`) + 방별 accumulator, 상한(방 32·동시 8·인원 8) |
| `loop` | `GameLoop`, `LoopMetrics` | 단일 스레드 5Hz 스케줄러, `tickRoom`, 라운드 종료 판정, delta/leaderboard 브로드캐스트 |
| `domain` | `World`, `GameCore`, `PlayerAi`, `StartCellAssigner`, `Types` | 권위 시뮬레이션(=core.ts 미러). `EnvAi`는 **사장(dead code)** |
| `config` | `GameConfig`, `ConfigService`, `HolderIds`, `Palette`, `CorsConfig` | 튜닝 상수(WELCOME으로 배포·admin 리로드), 예약 holderId, 색 슬롯 |
| `session` | `SessionService`, `PlayerSession` | 토큰 기반 세션·재접속 복구(`joinOrRestore`/`roomOf`) |
| `auth` | `FirebaseAuthService`, `AccountService`, `AppUser`, `Friendship`, `PresenceRegistry`, `AccountController`, `FriendController` | 구글 토큰 검증, 계정·전적, 친구 관계·접속 현황 |
| `ranking` | `RankingService`, `RankingController` | Redis 명예의 전당(`hof:wins` ZSET), `GET /ranking/top` |
| `admin` | `AdminController` | `/healthz`, `/admin/metrics`, `/admin/config`(GET/POST) |
| `data` | `BoundaryDataLoader`, `MapCatalog` | 전처리된 `kr-sgg-cells.json` 로드(인접·경계·반경 precompute) |

### 3.3 GameLoop — 틱 흐름
- `Executors.newSingleThreadScheduledExecutor("game-loop")` 하나. **모든** 월드 mutate·방 멤버십 변경·라운드 전환이 이 스레드에서만 일어난다(락 불필요). 컨트롤러는 `runOnRoom`/`submitOnRoom`(월드 액션)·`submitRoomTask`(멤버십)로만 접근.
- `TICK_MS = 200`(5Hz). 매 tick `playingRooms()`를 순회하며 방마다: `tickProduction → tickOrders → tickOrderClashes → tickAnnex` → (주기 게이트) AI/미사일 스폰/보급/공격 큐 → `broadcastDelta` → 순위(1Hz) → `checkRoundEnd`.
- 방별 예외는 격리(한 방이 죽어도 다른 방은 계속). 빈 방은 주기적으로 청소. tick 통계는 `LoopMetrics`가 집계(`/admin/metrics`).
- **라운드 종료**: 시간 초과(`roundDurationSec`, 매 tick) 또는 도미네이션(`dominationHolder ≥ 51%`, 1Hz). `endRound`가 `RoundEndMessage` 브로드캐스트 → 사람 우승자 Redis 기록 + 로그인 멤버 전적 갱신 → 월드를 빈 것으로 교체 → `state=LOBBY`.
- **브리지 기본 방**(`default`): 부팅 시 PLAYING으로 떠서 레거시 `/topic/world`·`/topic/leaderboard`·`/app/join`을 미러링(스모크 테스트용). 로비엔 안 뜨고 라운드 종료도 없다.

### 3.4 재접속·세션
- WS 핸드셰이크마다 익명 `StompPrincipal(UUID)` 부여(`/user/queue/*` 라우팅 키). 로그인은 WS 계층이 아니라 명령 payload의 `idToken`으로 처리.
- `ConnectionRegistry`가 `principal → RoomBinding(roomId, holderId)`를 들고, 액션 컨트롤러가 principal로 방을 해석.
- 재접속: 저장된 `token`으로 `SessionService.roomOf`를 찾아 같은 방·holder 복구(월드에 holder가 남아 있으면 재사용, 없으면 새로 배정). `SessionEventListener`가 연결 해제 시 멤버 제거·방장 승계·빈 방 폐기.

---

## 4. 데이터 파이프라인

- **클라**: `loadMapData(mapId)`가 `kr-sgg.geojson`을 fetch → `DongStaticMeta[]`(polylabel 중심점 포함) 생성 → TopoJSON `topology()`+`neighbors()`로 `neighborIndex` → 아크 추출(`sggBoundary`/`sidoBoundary`/`outer` 플래그, `borderMask`). 지도별로 한 번만 로드·캐시(`App.tsx mapCacheRef`).
- **서버**: 런타임에 인접을 계산하지 않는다. `server/tools/data-gen`이 오프라인에서 인접·경계·반경을 미리 계산해 `kr-sgg-cells.json`으로 굽고, `BoundaryDataLoader`가 그걸 읽는다(`cells.size == n` 단언).
- **admIndex 일치**: 클라·서버가 같은 셀 집합을 같은 순서로 읽어 `admIndex`(feature id 겸 배열 인덱스)가 구조적으로 일치한다 — 프로토콜은 인덱스만 주고받는다.

---

## 5. 성능 · 렌더링 원칙

- 250셀을 매 프레임 순회하지 않는다 — `dirty: Set<number>`에 변경 셀만 모아 rAF에서 배치 리페인트.
- 소유권 색은 `setFeatureState`(paint 재계산만, 지오메트리 유지)로 갱신 — React 리렌더 없음.
- 국경선은 아크(공유 경계) 단위로, 소유주가 다른 경계만 그린다(내부 경계 숨김) → 선 수 최소화.
- 서버 DELTA는 변경 셀·유닛·이벤트만 싣고, 순위·포위 집합·전술핵 쿨다운은 바뀐 tick에만 보낸다.

---

## 6. 영속성 (없음 — 명시)

- 게임 월드는 **완전히 휘발성**이다. `RoomManager`의 인메모리 맵에만 존재하며, 라운드마다 새 `World`를 만들고 종료 시 교체한다. 예전의 `SnapshotService`/`persistence` 패키지는 **제거됐다**(코드에 없음, `.gitignore`·구 문서에 잔재 언급만 남음).
- 유일한 지속 상태: **계정·친구**(H2 파일 DB `server/data/users`) + **랭킹**(Redis `hof:wins`). 이 둘이 없거나 죽어도 게임 진행 자체는 영향받지 않는다(랭킹은 조용히 비활성).

---

## 7. 배포 (Docker / GHCR / VM)

- **단일 오리진 3-스테이지 Dockerfile**: ① `node:22-alpine`로 `web/` 빌드(빌드타임 `VITE_FIREBASE_*` 주입) → ② `temurin:21-jdk`로 `web/dist`를 함께 `deployJar` 빌드 → ③ `temurin:21-jre`가 `app.jar` 하나를 `:8080`에서 실행(웹 정적 + REST + WS 동일 오리진, CORS 불필요).
- **CI**(`.github/workflows/deploy.yml`): `main` push(또는 수동) → 이미지 빌드 후 `ghcr.io/madcamp-official/best-project`에 `:latest`·`:<sha>` 태그 push. 데모 중엔 push 트리거를 꺼서 진행 중인 게임이 끊기지 않게 한다.
- **VM**(`deploy/docker-compose.yml`): `game`(GHCR 이미지, `3000:8080`, Cloudflare 터널로 TLS 종단) + `redis`(7-alpine, ZSET 랭킹) + `watchtower`(30s마다 `:latest` 자동 pull·재기동). H2 DB·Firebase 키는 볼륨(`./data`, `./secrets`)으로 주입. `:<sha>` 태그를 compose에 고정하면 롤백.
- **로컬 단일 jar**: `./gradlew deployJar && java -jar build/libs/server-*-deploy.jar`.

### 환경 변수 요약
| 변수 | 대상 | 용도 |
|---|---|---|
| `VITE_USE_LOCAL_MOCK` | 웹 | `"1"` → 브라우저 내 목 서버(백엔드 불필요) |
| `VITE_WS_URL` / `VITE_API_URL` | 웹 | STOMP/REST 주소 오버라이드(기본은 `window.location`에서 유도) |
| `VITE_FIREBASE_API_KEY`/`AUTH_DOMAIN`/`PROJECT_ID`/`APP_ID` | 웹(빌드타임) | 구글 로그인. 비면 게스트만 |
| `REDIS_HOST` | 서버 | 랭킹 Redis 호스트(기본 `localhost`) |
| `server.port` | 서버 | HTTP+WS+정적(기본 `8080`) |
| `app.firebase.service-account-path` | 서버 | Firebase Admin 키 경로(없으면 로그인 비활성) |

---

## 8. 확장 이음매

- **새 명령 추가**: `net/protocol.ts`(TS 타입) ↔ `ws/dto/Messages.kt`(Kotlin DTO)를 같은 커밋으로 정의 → `Connection`에 메서드 + `stompConnection`/`localConnection` 구현 → 서버 `*Controller`가 `runOnRoom`으로 `GameCore` 호출. 게임 규칙은 반드시 `core.ts`↔`GameCore.kt` 양쪽에 1:1로.
- **새 지도 추가**: `MapCatalog.RESOURCE_PATHS`(서버) + `MAP_ASSETS`(클라)에 항목 추가, `server/tools/data-gen`으로 셀 JSON 굽기. 현재는 `kr-sgg` 단일.
- **새 렌더 이펙트**: `MapView`의 rAF 루프 + 레이어 추가만으로. 게임 규칙 판단을 `map/`에 넣지 않는다(이식 대조가 깨짐).
