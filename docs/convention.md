# 개발 환경/컨벤션 가이드

## 1. 저장소 구조 (예정)

모노레포로 운영하며, 아래와 같은 최상위 디렉터리 구성을 기본안으로 한다.

```
best-project/
├── app/            # Flutter 클라이언트
├── server/         # Spring Boot 백엔드
├── contracts/      # Solidity 스마트 컨트랙트 (Hardhat)
└── docs/           # 프로젝트 문서
```

## 2. 브랜치 전략

- `main`: 배포/데모 가능한 안정 상태만 유지
- `develop`: 다음 데모를 위한 통합 브랜치
- `feature/{영역}-{작업내용}`: 기능 단위 작업 브랜치 (예: `feature/contract-commit-reveal`, `feature/app-room-list`)
- `fix/{내용}`: 버그 수정 브랜치

작업은 `feature`/`fix` 브랜치에서 진행 후 `develop`으로 PR을 통해 병합하고, 데모 전 안정화된 시점에 `develop` → `main`으로 병합한다.

## 3. 커밋 메시지 컨벤션

[Conventional Commits](https://www.conventionalcommits.org/) 형식을 따른다.

```
<type>(<scope>): <설명>
```

| type | 용도 |
| --- | --- |
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `docs` | 문서 변경 |
| `refactor` | 동작 변화 없는 코드 개선 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드, 설정 등 기타 변경 |

예시: `feat(contract): 커밋-리빌 해시 검증 로직 추가`

## 4. 코드 스타일

| 영역 | 도구/스타일 |
| --- | --- |
| Flutter (Dart) | `flutter_lints` 기본 규칙 준수, `dart format` 적용 |
| Spring Boot (Kotlin/Java) | 팀 언어 선택에 맞춰 `ktlint`(Kotlin) 또는 `google-java-format`(Java) 적용 |
| Solidity | `solhint` 기본 규칙 준수 |

## 5. PR 규칙

- PR 제목은 커밋 메시지 컨벤션을 따른다.
- PR 본문에는 변경 사항 요약과 테스트 방법을 간단히 기재한다.
- 최소 1인 이상의 리뷰 승인 후 병합한다.
- 병합 방식은 Squash and Merge를 기본으로 한다.

## 6. 미정 사항

- [ ] 백엔드 언어 최종 확정 (Kotlin vs Java)에 따른 린트 도구 확정
- [ ] CI(빌드/테스트 자동화) 도입 여부 및 파이프라인 구성
- [ ] 환경 변수/시크릿 관리 방식 (릴레이 지갑 프라이빗 키 등 민감정보 포함)
