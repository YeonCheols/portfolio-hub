# PROJECT.MD 입력 계약과 중앙 관리 지침

각 저장소 기본 브랜치 루트의 `PROJECT.MD`가 프로젝트 소개의 원본입니다. 각 저장소의 AI가 메타데이터와 본문을 작성·갱신하며 Hub는 AI로 다시 생성하지 않습니다. Hub는 이미 확정한 HEAD SHA에서 문서를 읽어 검증한 뒤 API에 전달합니다. README로 대체하거나 원본 문서를 되쓰지 않습니다.

## 문서 규격 v1

문서는 첫 줄의 JSON 코드 블록으로 시작합니다. 아래 예시처럼 메타데이터 뒤 빈 줄 다음에 마크다운 본문을 작성합니다. 본문의 제목·목차·구성은 자유입니다.

````markdown
```json
{
  "schemaVersion": 1,
  "slug": "my-project",
  "title": "프로젝트 제목",
  "description": "프로젝트 설명",
  "stacks": ["TypeScript", "Node.js"],
  "image": "https://example.com/project.png",
  "linkDemo": null,
  "linkGithub": null
}
```

# 프로젝트 소개

이 아래 마크다운을 API의 content로 그대로 사용합니다.
````

- 필수 메타데이터는 `schemaVersion: 1`, `slug`, `title`, `description`, `stacks`입니다. 계약 밖 JSON 필드와 지원하지 않는 버전은 거부합니다.
- `slug`는 1~200자의 영문·숫자·점·밑줄·하이픈이며 첫 문자는 영문·숫자입니다. 제목은 공백만 허용하지 않고 최대 500자, 설명은 최대 10,000자입니다.
- `stacks`는 문자열 배열입니다. Hub는 API 계약에 맞춰 JSON 문자열 배열로 직렬화하며 최대 길이는 10,000자입니다.
- `image`는 선택적인 공개 HTTP(S) URL입니다. 생략/null/빈 문자열은 `image: ""`로 전송해 이미지 없이 반영합니다. 기존 URL을 제거하면 기존 이미지 값도 비웁니다. 로컬 경로·data URL·자격 증명을 포함한 URL은 거부합니다.
- `linkDemo`, `linkGithub`는 선택적인 HTTP(S) 링크입니다. 생략/null/빈 문자열이면 null을 전송해 기존 링크를 삭제합니다. URL 길이는 각각 최대 4,096자입니다.
- 첫 JSON 블록과 구분용 빈 줄을 제외한 마크다운을 `content`로 전달합니다. 본문은 재생성하지 않습니다.
- slug가 바뀌면 다른 프로젝트가 생성될 수 있습니다. 기존 포트폴리오 항목을 업데이트하려면 기존 slug를 유지합니다. 누락된 저장소나 문서를 근거로 기존 프로젝트를 삭제하거나 숨기지 않습니다.

이 규격 문서의 제공은 해당 소개를 포트폴리오에 반영하기 위한 준비 상태를 의미합니다. API는 즉시 공개하고 관리자 편집 내용도 교체하므로 문서에는 공개 가능한 정보만 넣습니다. 다른 비공개 소스나 README를 임의로 공개하는 권한은 포함하지 않습니다.

## 이미지 소유권

대표 이미지 파일을 저장소에 보관할 때는 루트 `PROJECT.png`를 사용합니다. 배포 화면을 우선 활용하고 적절한 화면이 없으면 각 저장소에서 생성형 썸네일을 준비합니다. 공개 업로드와 공개 URL 준비는 해당 저장소가 담당하고 필요한 경우 갱신합니다. 특정 업로드 서비스는 강제하지 않습니다.

Hub는 이미지 파일을 읽거나 업로드하지 않고 문서의 공개 URL만 전달합니다. 공개 URL을 제공하지 못해도 프로젝트 반영을 막지 않습니다. 비공개 저장소의 접근 제한이 있는 원본 URL을 공개 URL처럼 쓰지 않습니다. URL의 실제 익명 접근 가능성과 지속성은 작성 저장소가 책임집니다.

## 수집·검증·API 반영

`read-document.ts`는 고정 SHA에서 UTF-8 문서와 출처 메타데이터를 읽으며 파일 상한은 256 KiB입니다. `parse-document.ts`가 규격을 검증하고 API 입력으로 변환합니다. 본문을 로그나 동기화 상태 파일에 기록하지 않습니다.

API 반영은 기존 README·manifest 수집 체크포인트와 분리합니다. 수집 SHA가 같아도 API에 미반영된 SHA이면 문서를 읽어 전송합니다. API 성공 응답을 확인한 뒤 `state/repositories.json`의 선택적 `applications`에 저장소 ID별 반영 SHA·시각·slug·대상 해시·입력 해시와 안전한 상태 코드만 저장합니다. 본문·URL 입력·토큰은 저장하지 않습니다. 기존 schemaVersion 1 상태를 유지하며 `applications`가 없는 기존 상태도 그대로 읽습니다. 이전 코드로 롤백하면 새 필드를 지원하지 않아 안전하게 실패할 수 있으므로 자동으로 필드를 삭제하지 않습니다.

- 같은 API 대상에서 서로 다른 저장소가 같은 slug를 제공하면 뒤의 반영을 `PORTFOLIO_API_INVALID_INPUT`으로 거부합니다. 각 저장소는 고유한 slug를 사용합니다.
- API 실패: 이전 성공 SHA·시각·해시를 보존하고 다음 실행에서 재시도합니다. 같은 요청을 재전송해도 서버의 `unchanged` 결과로 안전하게 복구할 수 있습니다.
- 문서 없음: `pending`으로 기록하고 이후 다시 확인합니다. 문서 부재만으로 작업 전체를 실패시키거나 기존 공개 항목을 삭제하지 않습니다.
- 문서 손상·규격 오류·API 오류: 안전한 실패 코드만 기록하고 나머지 저장소를 처리한 뒤 종료 코드 1을 반환합니다.
- 같은 API 대상의 성공 SHA가 같으면 건너뜁니다. API 대상 URL이나 입력 계약 버전이 달라지면 대상 해시가 달라져 다시 반영합니다.
- archived·fork·빈 저장소는 API 쓰기를 건너뜁니다. 수집 상태와 날짜별 수집 실패 이력은 기존 계약을 유지합니다.
- 최종 상태 저장이 실패하면 작업은 실패합니다. 이미 수행한 API 호출은 되돌리지 않으며 다음 실행에 재전송합니다. 수집·반영 메타데이터는 기존 상태 저장소에서 같은 커밋으로 영속화합니다.

## 중앙 지침과 온보딩 PR

공통 지침의 원본은 [`src/project-document/guidance.ts`](../src/project-document/guidance.ts)의 `PROJECT_GUIDANCE`입니다. 각 저장소의 루트 `AGENTS.md`에 전용 구간으로 설치하도록 PR을 제안하며 담당자가 직접 머지합니다. 문서 규격 변경은 중앙 지침 변경으로 배포합니다. 지침 PR 머지는 문서·이미지 생성이나 API 반영 성공이 아닙니다.

수집 SHA가 같아도 매번 지침을 확인합니다. AGENTS.md가 없으면 생성하고 있으면 기존 내용 뒤에 구간을 추가하며 이전 관리 구간은 그 구간만 교체합니다. 기존 규칙은 보존하고 충돌·중복 의미 판단은 PR에서 검토합니다. 깨진 표식, 중복 구간, 심볼릭 링크, 비 UTF-8, 64 KiB 초과 파일은 덮어쓰지 않습니다.

- `portfolio-hub/project-guidance-<지침 해시>` 브랜치와 기본 브랜치 대상 PR을 제안합니다. 기본 브랜치 직접 수정·강제 푸시·자동 머지는 하지 않습니다.
- 이전 버전을 포함해 열린 온보딩 PR이 있으면 기다립니다. 같은 버전의 닫힌 PR도 반복 생성하지 않습니다. 재적용은 기존 PR 재개 또는 수동 반영으로 처리합니다.
- PR 생성 전에 중단됐으면 부모와 트리가 같은 브랜치만 재사용합니다. 다른 브랜치 내용은 덮어쓰지 않고 담당자의 복구를 기다립니다.
- archived·fork·빈 저장소에는 초기화 커밋이나 온보딩 PR을 만들지 않습니다.
- 결과는 `onboarding.created/pending/closed/current/skipped/failed` 집계만 출력합니다. 비공개 저장소 이름·PR URL·문서 본문·원문 오류를 출력하지 않습니다.

## 실행 설정

모든 기능은 기존 GitHub App 읽기 토큰과 Hub 상태 저장 토큰을 유지합니다. 아래 두 쓰기 기능은 서로 독립적으로 켤 수 있으며 미설정 상태에서는 기존 수집만 실행합니다. 활성화 후 필요한 설정이 누락되면 조용히 생략하지 않고 실패합니다.

### 프로젝트 API

Hub 저장소 Actions에 다음을 설정합니다.

- Variable `HUB_PROJECT_SYNC_ENABLED=true`
- Variable `PORTFOLIO_API_URL`: 대상 API의 HTTPS 루트 URL입니다. 정식 API 주소는 `https://api.ycseng.com`입니다. 사용자명·비밀번호·query·fragment·하위 경로가 있는 주소는 거부합니다.
- Variable `PORTFOLIO_SERVICE_CLIENT_ID`: portfolio-api의 `SERVICE_OAUTH_CLIENT_ID`와 같은 값입니다.
- Secret `PORTFOLIO_SERVICE_CLIENT_SECRET`: portfolio-api의 `SERVICE_OAUTH_CLIENT_SECRET`과 같은 값입니다.

API 측에는 기존 issuer·서명 키와 서비스 audience 설정이 필요합니다. Hub는 `POST /auth/token`의 client_credentials로 15분 토큰을 발급받고 `PUT /service/project`를 호출합니다. 자격은 form 인코딩 후 Basic 인증으로 전달하며 토큰 만료 전 재발급합니다. 자격·토큰·요청 본문·응답 원문은 로그로 남기지 않습니다. 리디렉션을 따라가지 않고 각 요청에 제한 시간을 적용합니다.

### 온보딩 PR

수집 App은 계속 `Metadata: read`, `Contents: read`를 사용합니다. 조직에 별도 쓰기용 App을 설치하고 대상 저장소에 `Metadata: read`, `Contents: write`, `Pull requests: write`를 허용합니다.

- Variable `HUB_ONBOARDING_APP_CLIENT_ID`
- Secret `HUB_ONBOARDING_APP_PRIVATE_KEY`
- Variable `HUB_ONBOARDING_ENABLED=true`

워크플로가 별도 설치 토큰을 만들어 `HUB_ONBOARDING_TOKEN`으로 주입합니다. 기존 수집 App을 쓰기 권한으로 승격하지 않습니다. 실제 App·서비스 자격 설정 및 변경 코드 배포 전에는 자동 PR이나 프로젝트 API 반영이 실행되지 않습니다.
