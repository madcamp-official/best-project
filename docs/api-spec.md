# API 명세서

> 통신 계층 사양. 게임 규칙 자체는 [README.md](../README.md), 아키텍처는 [architecture.md](./architecture.md) 참조.
> 최종 진실은 코드: 클라 `web/src/net/protocol.ts` ↔ 서버 `server/.../ws/dto/Messages.kt`가 원본이며 필드는 두 파일이 항상 동기.
> 필드명·타입이 이 문서와 어긋나면 코드가 기준이다.

---

## 1. 개요

- **전송**: STOMP over WebSocket(SockJS 폴백). 엔드포인트 `ws(s)://<host>/ws`. 서버 하트비트 10s/10s.
- **접두**: 클라→서버 `/app/...`, 브로드캐스트 `/topic/...`, 개인 응답 `/user/queue/...`.
- **다중 방(룸 스코프)**: 게임 토픽은 방마다 다르다 — `/topic/room/{roomId}/...`. 로비 목록만 전역 `/topic/rooms`. 한 연결은 로비 채널(공통) + 현재 들어간 방 채널(동적 구독)을 함께 듣는다.
- **인증**: WS 핸드셰이크는 익명(연결마다 랜덤 principal). 로그인은 명령 payload의 `idToken`(Firebase)으로 처리하고, 서버가 요청 시 검증한다. 게스트는 `idToken` 없이 전부 사용 가능.
- **동기화 모델**: 입장 시 `WELCOME`(전체 스냅샷 1회) → 이후 `DELTA`(변경분, 5Hz) + `LEADERBOARD`(1Hz). 인덱스는 `admIndex`(0..n-1) 기준 — 클라·서버가 같은 셀 순서를 공유하므로 인덱스만 주고받는다.
- **REST**: 계정·친구·랭킹·운영은 별도 HTTP(§4). 배포는 단일 오리진(웹 정적·WS·REST 동일 `:8080`)이라 CORS는 `/api/**`에만 열려 있다.

### 목적지 요약

| 방향 | 목적지 | 메시지 |
|---|---|---|
| C→S | `/app/join` | `JoinMessage` — 레거시/스모크 브리지(기본 방 입장), `/user/queue/welcome` 응답 |
| C→S | `/app/lobby/list` | (없음) — 방 목록 요청 |
| C→S | `/app/lobby/create` | `CreateRoomCommand` |
| C→S | `/app/lobby/join` | `JoinRoomCommand` |
| C→S | `/app/lobby/joinByCode` | `JoinByCodeCommand` — 비공개 방 코드 입장 |
| C→S | `/app/room/start` | (없음) — 방장만, LOBBY→PLAYING |
| C→S | `/app/room/ready` | `SetReadyCommand` |
| C→S | `/app/room/leave` | (없음) |
| C→S | `/app/sortie` | `SortieCommand` |
| C→S | `/app/march` | `MarchCommand` |
| C→S | `/app/sortie-multi` | `MultiSortieCommand` |
| C→S | `/app/attack-queue` | `ToggleAttackTargetCommand` |
| C→S | `/app/missile` | `LaunchMissileCommand` |
| C→S | `/app/nuke` | `LaunchNukeCommand` |
| C→S | `/app/airdrop` | `AirdropCommand` |
| C→S | `/app/restart` | (없음) — 궤멸 후 재시작 |
| C→S | `/app/friends/hello` | `HelloCommand` — 접속 현황 등록 |
| C→S | `/app/friends/invite` | `InviteCommand` |
| S→C | `/topic/rooms` | `RoomListMessage` — 공개 방 목록(비공개·기본 방 제외) |
| S→C | `/topic/room/{id}/world` | `DeltaMessage`(5Hz) |
| S→C | `/topic/room/{id}/leaderboard` | `LeaderboardMessage`(1Hz) |
| S→C | `/topic/room/{id}/state` | `RoomStateMessage` 또는 `RoundEndMessage` |
| S→C | `/user/queue/welcome` | `WelcomeMessage` |
| S→C | `/user/queue/error` | `ErrorMessage` |
| S→C | `/user/queue/roomJoined` | `RoomJoinedMessage` |
| S→C | `/user/queue/friendPresence` | `FriendPresenceMessage` |
| S→C | `/user/queue/invite` | `InviteMessage` |
| S→C | `/topic/world`, `/topic/leaderboard` | (레거시) 기본 브리지 방 전용 미러 |

`/topic/room/{id}/state`는 `RoomStateMessage`와 `RoundEndMessage`를 함께 싣고, 클라는 `reason` 필드 유무로 구분한다.

---

## 2. 로비 · 방 생명주기

방 상태기계: `LOBBY → PLAYING → ENDED → LOBBY`.

1. **입장(실서버)**: `authChoice`(로그인/게스트) → `enterLobby` → `/app/lobby/list` → `/topic/rooms` 구독.
2. **방 생성**: `/app/lobby/create`(`CreateRoomCommand`) → `/user/queue/roomJoined`(`RoomJoinedMessage`, `youAreHost=true`). 비공개면 4자리 `joinCode` 발급.
3. **방 입장**: `/app/lobby/join`(공개) 또는 `/app/lobby/joinByCode`(비공개) → `roomJoined` + 그 방의 `/topic/room/{id}/*` 구독. PLAYING 방엔 라이브 난입(곧 WELCOME).
4. **준비/시작**: 멤버는 `/app/room/ready`(`SetReadyCommand`). 방장이 `/app/room/start` → 서버가 새 월드 생성 + 멤버마다 시작 셀 배정 + AI 채우기 → 각자 `/user/queue/welcome` 전송, `state=PLAYING`.
5. **진행**: 각 방 `/topic/room/{id}/world` DELTA(5Hz), `/leaderboard`(1Hz).
6. **종료**: 51% 도미네이션 또는 30분 → `/topic/room/{id}/state`에 `RoundEndMessage` → 결과 화면 → `state=LOBBY`(멤버 유지, 다시 시작 가능).
7. **이탈/해제**: `/app/room/leave` 또는 연결 끊김 → 멤버 제거·방장 승계·빈 방 폐기(`SessionEventListener`). `RoomStateMessage`로 갱신.

---

## 3. 메시지 카탈로그

> 표기: `?` = 선택(nullable/기본값 있음). 배열 인덱스는 `admIndex`. 좌표는 `[lng, lat]`.

### 3.1 C→S 명령

```ts
JoinMessage                { nickname?, token?, idToken? }
CreateRoomCommand          { name?, mapId?, nickname?, token?, idToken?, clientId?, private=false }
JoinRoomCommand            { roomId, nickname?, token?, idToken?, clientId? }
JoinByCodeCommand          { code, nickname?, token?, idToken?, clientId? }
SetReadyCommand            { ready }
SortieCommand              { from, to, ratio? }        // ratio 서버에서 0.05~1.0 클램프
MarchCommand               { from, to, ratio? }        // 내 영토 BFS 릴레이
MultiSortieCommand         { from=-1, targets: number[], ratio? }  // 드래그 쓸기 균등 분할
ToggleAttackTargetCommand  { index=-1 }                // 공격 큐 등록/해제
LaunchMissileCommand       { center: [lng,lat], radius, hits: number[] }  // 서버가 반경·근접 재검증
LaunchNukeCommand          { center: [lng,lat], radius, hits: number[] }  // 서버가 반경 재계산
AirdropCommand             { sources: number[], dest=-1 }
// /app/restart, /app/room/start, /app/room/leave, /app/lobby/list = payload 없음
HelloCommand               { idToken? }                // 친구 접속 현황 등록(주기 ping)
InviteCommand              { idToken?, targetAppUserId }
```

### 3.2 S→C: WELCOME (입장 시 1회, 전체 스냅샷)

```ts
WelcomeMessage {
  roomId, mapId, roundEndsAtMs,     // roundEndsAtMs=0 → 제한 없음(브리지 기본 방)
  holderId, token, paletteIdx,      // 내 신원·색 슬롯. token은 재접속 복구용
  config: GameConfig,               // 서버 튜닝 상수 전체(클라가 이 값을 원본으로 사용)
  serverTimeMs,                     // 시간 동기화 기준(§5)
  meta: DongStaticMeta[],           // 셀 정적 메타(admIndex 순)
  neighborIndex: number[][],        // 인접 그래프
  ownerId: number[], troops: number[], troopCap: number[],
  holders: Holder[],                // {id, name, paletteIdx, isAi}
  orders: Order[],                  // 이동 중 유닛
  missiles: number[],               // 미사일 얹힌 셀
  attackQueue: number[],            // 내 공격 큐 대상
  shields: ShieldInfo[],            // 활성 방어막 {holderId, until}
  nukeReadyAtMs: number[]           // 사일로별 재발사 가능 시각(NUKE_SILO_CODES 순)
}
```

### 3.3 S→C: DELTA (변경분, 5Hz, `/topic/room/{id}/world`)

```ts
DeltaMessage {
  serverTimeMs,
  cells: number[][],          // [admIndex, ownerId, troops] 변경 셀만
  newOrders: Order[],         // 새로 출발한 유닛
  removedOrders?: number[],   // 사라진 유닛 id(정면충돌·미사일 등)  ─┐ @JsonInclude(NON_NULL)
  updatedOrders?: {id,amount}[], // 병력 변한 유닛                   │
  events,                     // 로그 이벤트
  missileAdd: number[], missileRemove: number[], missileImpacts: number[],
  newHolders: Holder[],       // 이번 구간 새로 생긴 holder(색 동기화 — 셀보다 먼저 적용)
  shieldUpdates: ShieldInfo[],
  enclosed?: number[],        // 현재 포위 대기 셀 전체(바뀐 tick에만)   │
  nukeReadyAtMs?: number[]    // 전술핵 쿨다운(바뀐 tick에만)          ─┘
}
```
- `newHolders`를 셀보다 **먼저** 적용해야 신규 참가자의 땅이 회색(fallback)으로 잠깐 칠해지는 일이 없다.
- 변경이 하나도 없으면 DELTA를 아예 보내지 않는다.

### 3.4 S→C: LEADERBOARD (1Hz, `/topic/room/{id}/leaderboard`)

```ts
LeaderboardMessage {
  rows: { holderId, name, count }[],   // 셀 수 내림차순(중립·E 제외)
  envCells,                            // (레거시) 환경 세력 셀 수 — 현재 항상 0
  totalCells                           // 전체 셀 수(비율 계산용)
}
```

### 3.5 S→C: 방 메시지

```ts
RoomInfo         { roomId, name, mapId, state, memberCount, maxMembers }
RoomListMessage  { rooms: RoomInfo[] }
MemberInfo       { nickname, holderId, ready, host }
RoomJoinedMessage{ roomId, name, mapId, state, members: MemberInfo[], youAreHost, joinCode? }
RoomStateMessage { roomId, state, members: MemberInfo[] }
RoundEndMessage  { roomId, reason, winnerHolderId, winnerName?, leaderboard: LeaderboardRow[] }
                 // reason = "DOMINATION" | "TIMEOUT"  ← RoomStateMessage와 구분하는 키
```

### 3.6 S→C: 친구·초대·에러

```ts
FriendPresence        { appUserId, nickname, roomId?, roomName? }
FriendPresenceMessage { friends: FriendPresence[] }
InviteMessage         { fromNickname, roomId, roomName, joinCode? }
ErrorMessage          { code, message, from, to }
```
`ErrorMessage.code`(대표): 좌석/방 관련 `ROOM_FULL`·`ROOM_NOT_FOUND`·`ROOM_LIMIT`, 액션 검증 `NOT_OWNER`·`NOT_ADJACENT`·`NO_TROOPS`·`ALREADY_FULL`·`NO_PATH`·`AIRDROP_COOLDOWN`·`AIRDROP_RANGE`·미사일/전술핵 반경·방어막 거부 등. 클라는 토스트로 표시하고, `ROOM_NOT_FOUND`면 로비로 돌아간다.

### 3.7 참조 타입

```ts
Holder         { id, name, paletteIdx, isAi }
Order          { id, from, to, amount, holderId, departTick, arriveTick, path?, airdrop? }
ShieldInfo     { holderId, until }        // until = 보호 종료 시각(서버 epoch ms)
LeaderboardRow { holderId, name, count }
DongStaticMeta { admIndex, code, name, sggcd, sggnm, sidocd, sidonm, centroid: [lng,lat] }
```
- **holderId 규약**: `0` = 중립 · `1~254` = 플레이어·AI 공용(사람/AI 같은 할당기) · `255` = 예약(구 환경 세력 E, 현재 미사용). 색은 `holder.paletteIdx`(슬롯)로 정하며 holderId와 무관.
- `DongStaticMeta`의 `code`는 시/군/구 `sggcd`(5자리). 필드명이 `Dong`으로 남아 있지만 셀은 시/군/구다.

---

## 4. HTTP (REST) 엔드포인트

동일 오리진 `:8080`. `/api/**`만 CORS 허용(GET/POST).

| 메서드·경로 | 용도 | 요청/응답 |
|---|---|---|
| `POST /api/account/me` | 내 프로필 조회 | `{ idToken }` → `AccountProfile{ appUserId, nickname, level, wins, gamesPlayed }` |
| `POST /api/account/nickname` | 닉네임 변경 | `{ idToken, nickname }` → `AccountProfile` |
| `POST /api/friends/search` | 닉네임 검색 | `{ idToken, query }` → 후보 목록 |
| `POST /api/friends/request` | 친구 요청 | `{ idToken, targetAppUserId }` |
| `POST /api/friends/respond` | 요청 수락/거절 | `{ idToken, requesterId, accept }` |
| `POST /api/friends/list` | 친구·대기 목록 | `{ idToken }` → `{ friends, incoming, outgoing }` |
| `GET /ranking/top?limit=` | 명예의 전당 | `limit`(1~50) → 누적 우승 상위(닉네임·점수) |
| `GET /healthz` | 헬스체크 | `"ok"` |
| `GET /admin/metrics` | 운영 지표 | tick 통계·방·인원·힙 |
| `GET /admin/config` | 현재 튜닝 | `GameConfig` |
| `POST /admin/config` | 튜닝 부분 갱신 | 부분 JSON → 현재 config에 병합·적용(런타임 반영) |

- 계정·전적은 H2, 랭킹은 Redis. **랭킹 우승 기록은 서버 `GameLoop.endRound`에서** 사람 우승자(`isAi=false`)만 남긴다. `/admin/config`는 현재 별도 인증이 없다(운영 시 주의).
- 레벨: `level = 1 + floor(wins/3)`.

---

## 5. 시간 동기화

- 서버는 `serverTimeMs`(epoch ms)를 WELCOME·DELTA에 싣는다. 클라는 WELCOME 수신 순간의 `serverTimeMs`와 로컬 `performance.now()` 오프셋을 계산해 유닛 도착 시각(`departTick`/`arriveTick`)과 라운드 타이머(`roundEndsAtMs`)를 로컬 시계로 환산한다.
- 재접속 시 오프셋을 다시 잡으므로 시계 드리프트가 누적되지 않는다.

---

## 6. 프로토콜 변경 규칙

- 필드는 **append-only**를 지향한다(구 클라 호환). 삭제·의미 변경은 `protocol.ts`↔`Messages.kt` **같은 커밋**으로만.
- 문서와 코드가 어긋나면 코드가 기준 — 이 문서를 코드에 맞춰 갱신한다.
