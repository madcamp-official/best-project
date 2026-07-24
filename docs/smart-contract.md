# 스마트 컨트랙트 설계 문서

## 1. 개요

- **언어**: Solidity (^0.8.x)
- **배포 네트워크**: Polygon Amoy 테스트넷 (EVM 호환)
- **개발/테스트 도구**: Hardhat
- **역할**: 예측값의 커밋-리빌 처리, 라운드 정산(2등 판별), ERC20 보상 토큰 지급을 신뢰 없이(trustless) 수행

## 2. 컨트랙트 구성

| 컨트랙트 | 역할 |
| --- | --- |
| `GameRoom.sol` | 방 생성, 참가자 관리, 라운드 생성/상태 전이 |
| `PredictionAuction.sol` | 예측값 커밋/리빌 접수, 2등 판별 정산 로직 |
| `RewardToken.sol` | ERC20 보상 토큰 (OpenZeppelin `ERC20` 상속) |

라운드 단위 로직이 `PredictionAuction`에 집중되고, `GameRoom`이 방·참가자·라운드 순번을 관리하며 `PredictionAuction`을 호출하는 구조를 기본안으로 한다. (모놀리식 단일 컨트랙트로 단순화하는 방안도 구현 단계에서 재검토 가능)

## 3. 커밋-리빌 방식

### 3.1 커밋 해시 계산

```solidity
commitHash = keccak256(abi.encodePacked(price, salt, msg.sender))
```

- `price`: 참가자가 예측한 가격 (정수, 단위는 원/센트 등 추후 확정)
- `salt`: 클라이언트에서 생성하는 난수. 동일한 `price`를 제출해도 해시가 달라지도록 하여 사전 추측(레인보우 테이블) 공격을 방지
- `msg.sender`를 해시에 포함해 다른 사람의 커밋을 그대로 재사용(replay)하는 것을 방지

클라이언트는 리빌 전까지 `price`와 `salt`를 로컬에 보관해야 한다.

### 3.2 상태 전이

```
Created → Committing → Revealing → Settled
```

| 상태 | 설명 |
| --- | --- |
| `Created` | 출제자가 사진을 등록하고 라운드가 생성됨 |
| `Committing` | 참가자들이 `commit(bytes32 commitHash)` 호출 가능 |
| `Revealing` | 전원 커밋 완료(또는 제한시간 도달) 후, 참가자들이 `reveal(uint256 price, bytes32 salt)` 호출 가능 |
| `Settled` | 전원 리빌 완료(또는 제한시간 도달) 후 `settle()` 호출로 2등 판별 및 보상 지급 완료 |

## 4. 주요 함수 명세 (초안)

| 함수 | 설명 |
| --- | --- |
| `createRoom(address[] participants)` | 방 생성 및 참가자 등록 |
| `startRound(bytes32 photoCidHash)` | 출제자가 새 라운드를 시작하며 IPFS 사진 CID의 해시를 기록 |
| `commit(uint256 roundId, bytes32 commitHash)` | 참가자가 예측값 커밋 등록 |
| `reveal(uint256 roundId, uint256 price, bytes32 salt)` | 커밋 해시와 대조하여 검증 후 예측값 공개 |
| `settle(uint256 roundId)` | 공개된 값들을 정렬해 2등 판별, 승자에게 `RewardToken` 지급 |
| `claimReward()` | (선택) 즉시 지급 대신 승자가 직접 보상을 청구하는 방식일 경우 사용 |

모든 함수는 백엔드의 릴레이 지갑을 통해 호출되는 것을 기본 흐름으로 하되, 최종 실행자(실질적 소유자)는 컨트랙트 내부적으로 별도 파라미터(`address player`)로 구분해 기록한다. (지갑 추상화 방식은 5절 참고)

## 5. 지갑 추상화 (릴레이 방식)

사용자가 개인 지갑(MetaMask 등)이나 가스비 없이도 참여할 수 있도록, 백엔드가 운영하는 **릴레이 지갑**이 실제 트랜잭션을 서명·전송한다.

- 사용자는 앱에서 예측값(및 salt)만 생성하고, 이를 백엔드로 전달한다.
- 백엔드는 사용자의 요청을 검증한 뒤, 릴레이 지갑으로 해당 함수 호출을 온체인에 전송한다.
- 실제 행위자를 구분하기 위해 함수에 `address player` 파라미터를 두거나, EIP-2771 메타트랜잭션 표준(Trusted Forwarder)을 도입하는 방안을 검토한다. 초기 버전은 구현 단순성을 위해 `player` 파라미터 방식으로 시작하고, 필요 시 메타트랜잭션 표준으로 전환한다.
- 이 구조에서도 커밋 해시와 리빌 검증은 컨트랙트 로직으로 강제되므로, 백엔드가 예측값 자체를 조작할 수는 없다. (자세한 신뢰 모델은 [architecture.md](architecture.md) 4절 참고)

## 6. 보안 고려사항

- **재진입 공격(Reentrancy)**: 보상 토큰 지급 시 Checks-Effects-Interactions 패턴 및 OpenZeppelin `ReentrancyGuard` 적용
- **커밋 재사용 방지**: 커밋 해시에 `msg.sender`(또는 `player` 주소) 포함
- **리빌 검증 실패 처리**: 커밋 해시와 일치하지 않는 리빌은 revert, 해당 참가자는 미제출로 간주해 정산에서 제외
- **제한 시간 강제**: 각 상태(Committing/Revealing)에 블록 타임스탬프 기반 마감 시각을 두어, 지연 제출로 인한 게임 진행 불가 상황 방지
- **정수 오버플로우**: Solidity 0.8.x는 기본 오버플로우 체크를 제공하므로 별도 SafeMath 불필요

## 7. 미정 사항

- [ ] `GameRoom` / `PredictionAuction` 분리 여부 최종 확정 (가스비 최적화 관점에서 재검토)
- [ ] 메타트랜잭션(EIP-2771) 도입 여부
- [ ] 가격 단위 및 정밀도(소수점 처리 방식)
- [ ] 보상 토큰 발행량 및 정산 시 지급 수량 로직 (토큰 이코노미와 연동)
- [ ] 컨트랙트 감사/테스트 커버리지 목표
