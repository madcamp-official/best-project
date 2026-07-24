# API 명세서

> 기획 단계 초안입니다. 요청/응답 필드는 구현 과정에서 변경될 수 있습니다.

## 1. 공통 사항

- **Base URL**: `https://{host}/api/v1` (추후 확정)
- **인증**: 로그인 시 발급되는 JWT를 `Authorization: Bearer {token}` 헤더로 전달
- **응답 포맷**: JSON, 공통 에러 포맷은 아래 형태를 기본으로 한다.

```json
{
  "code": "ROOM_NOT_FOUND",
  "message": "존재하지 않는 방입니다."
}
```

## 2. REST API

### 2.1 인증/유저

| Method | Endpoint | 설명 |
| --- | --- | --- |
| POST | `/auth/signup` | 회원가입 |
| POST | `/auth/login` | 로그인, JWT 발급 |
| GET | `/users/me` | 내 프로필 및 누적 보상 토큰 조회 |

### 2.2 방(Room)

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/rooms` | 공개 방 목록 조회 |
| POST | `/rooms` | 방 생성 (공개/비공개 여부 포함) |
| GET | `/rooms/{roomId}` | 방 상세 정보 조회 |
| POST | `/rooms/{roomId}/join` | 방 입장 (비공개 방은 `roomCode` 필요) |
| POST | `/rooms/{roomId}/start` | 게임 시작 (호스트 전용, 최소 인원 충족 시) |

### 2.3 라운드(Round)

| Method | Endpoint | 설명 |
| --- | --- | --- |
| POST | `/rooms/{roomId}/rounds/{roundId}/photo` | 출제자가 사진 업로드 → IPFS 저장 및 온체인 라운드 생성 트리거 |
| POST | `/rooms/{roomId}/rounds/{roundId}/commit` | 예측값 커밋 해시 제출 |
| POST | `/rooms/{roomId}/rounds/{roundId}/reveal` | 예측값(price, salt) 공개 제출 |
| GET | `/rooms/{roomId}/rounds/{roundId}` | 라운드 상태 및 결과 조회 |
| GET | `/rooms/{roomId}/rounds/{roundId}/result` | 정산 결과(승자, 공개된 예측값 목록) 조회 |

### 2.4 결과/보상

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/rooms/{roomId}/leaderboard` | 게임 종료 후 최종 순위 조회 |
| GET | `/users/me/rewards` | 내 보상 토큰 지급 내역 조회 |

## 3. WebSocket (STOMP)

- **연결 엔드포인트**: `/ws` (SockJS fallback 포함 검토)
- **구독 경로 규칙**: `/topic/rooms/{roomId}`

| 이벤트 | 설명 | 페이로드 예시 |
| --- | --- | --- |
| `PARTICIPANT_JOINED` | 참가자 입장 | `{ userId, nickname }` |
| `PARTICIPANT_LEFT` | 참가자 퇴장 | `{ userId }` |
| `ROUND_STARTED` | 새 라운드 시작, 출제자 안내 | `{ roundId, quizMasterId }` |
| `PHOTO_REVEALED` | 출제 사진 공개 | `{ roundId, photoUrl }` |
| `SUBMISSION_PROGRESS` | 예측 제출 현황 갱신 | `{ roundId, submitted, total }` |
| `ROUND_REVEALED` | 예측값 전체 공개 및 정산 결과 | `{ roundId, predictions: [...], winnerId }` |
| `ROUND_ENDED` | 라운드 종료, 다음 출제자 안내 | `{ nextQuizMasterId }` |
| `GAME_ENDED` | 게임 종료, 최종 순위 안내 | `{ leaderboard: [...] }` |

## 4. 미정 사항

- [ ] 에러 코드 전체 목록 정의
- [ ] 페이징/정렬 파라미터 규칙 (방 목록 등)
- [ ] Rate limiting 정책
- [ ] API 문서 자동화 도구 도입 여부 (Swagger/OpenAPI)
