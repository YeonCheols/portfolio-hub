# Portfolio Hub

`side-projects-labs` Organization의 전체 저장소를 GitHub App으로 조회하고, 저장소 ID와 기본 메타데이터를 확인하는 중앙 실행 저장소입니다.

현재 범위는 조직 전체 저장소 탐색과 기본 브랜치의 프로젝트 정보 수집입니다. 선택적으로 규격 PROJECT.MD를 portfolio-api에 반영하며, AI 문서·이미지 생성은 각 저장소가 담당합니다.

## 구성

- TypeScript와 Node.js에서 Octokit REST API를 사용합니다.
- `GET /orgs/side-projects-labs/repos`를 페이지네이션해 전체 결과를 조회합니다.
- GitHub 저장소 ID로 중복을 제거하고 이름, 전체 경로, URL, 기본 브랜치, 공개 범위, 보관·포크 여부, 마지막 푸시 시각을 반환합니다.
- 각 저장소의 `defaultBranch` HEAD를 커밋 SHA로 고정하고 같은 커밋의 루트 구조와 프로젝트 파일을 읽습니다. 공개·비공개·내부 저장소를 동일하게 수집합니다.
- 루트 README와 `package.json`, `pnpm-workspace.yaml`, `go.mod`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, Maven·Gradle 설정, `composer.json`, `Gemfile`, `pubspec.yaml`, `Package.swift`, .NET 프로젝트·솔루션 파일을 읽습니다. 현재 하위 디렉터리의 모노레포 패키지나 전체 소스 코드는 읽지 않습니다.
- 파일별 256 KiB, 저장소별 본문 합계 1 MiB·30개로 제한하며 생략한 파일은 `skippedFiles`에 표시합니다. 환경변수·잠금 파일은 본문 수집 대상에서 제외합니다.
- 저장소는 한 번에 하나씩 처리합니다. 커밋이 없는 저장소는 `empty`로 표시하고, 조회 실패는 다른 저장소 처리를 계속한 뒤 실패 개수와 종료 코드 1로 알립니다.
- 같은 Hub의 `sync-state` 브랜치에 `state/repositories.json`을 보관합니다. 저장소 ID별 마지막 수집 성공 HEAD SHA가 현재 HEAD와 같으면 파일 본문을 다시 읽지 않습니다. 상태가 변경된 경우에만 커밋합니다.
- Actions 로그에는 공개 저장소 메타데이터와 수집된 README·설정 파일 본문을 출력합니다. 비공개·내부 저장소는 전체 개수와 제한된 저장소 개수만 표시합니다.
- 인증·권한·rate limit·요청 실패는 고정된 코드와 메시지로 변환합니다. 원문 응답과 토큰은 출력하지 않습니다.

## GitHub App 설정

GitHub App을 `side-projects-labs` Organization의 전체 저장소에 설치하고 `Metadata: read`, `Contents: write`, `Pull requests: write`를 승인합니다. 같은 App에서 수집용 읽기 토큰과 온보딩용 쓰기 토큰을 별도로 발급합니다. 수집 토큰은 계속 `metadata: read`, `contents: read`만 명시적으로 요청합니다.

정적 설정은 비공개 `portfolio-config`의 `environments/worker/portfolio-hub/.env` 한 파일에서 관리하며 개발·운영 환경을 나누지 않습니다. Hub Actions에는 최초 조회용 Secret `PORTFOLIO_CONFIG_READ_TOKEN`만 등록합니다. 이 토큰은 `YeonCheols/portfolio-config`의 Contents: read 권한으로 설정과 CLI 릴리스 파일을 읽으며 다음 단계에 넘기지 않습니다.

워크플로는 체크섬을 확인해 `cli-v0.3.0`을 설치한 뒤 `portfolio-config run --app portfolio-hub --inherit-env`로 설정 전달기를 실행합니다. App ID·Private Key·기능 활성화 값·API URL은 중앙 설정에서 공급하고 App 키는 로그에서 마스킹합니다. 별도 Actions Variables나 중복 App 키 Secret은 사용하지 않습니다.

워크플로는 실행할 때 설치 토큰을 발급하고 job 종료 시 폐기합니다. 공개 저장소이므로 private key, 토큰, 비공개 저장소의 이름과 URL을 로그에 출력하지 않습니다.

상태 파일 쓰기에는 Hub 작업의 `GITHUB_TOKEN`을 `HUB_STATE_TOKEN`으로 전달하고, `HUB_STATE_REPOSITORY`에는 `owner/repo`를 전달합니다. 워크플로의 `contents: write`는 Hub 상태 저장용이며 조직 App의 읽기 권한을 확장하지 않습니다.

상태 JSON은 공개 동기화 기록입니다. 사용자가 공개를 허용한 저장소 ID·경로·기본 브랜치·성공 SHA·시각·안전한 결과 코드만 기록하며 수집한 본문과 인증 정보는 넣지 않습니다. 자세한 구조와 복구 규칙은 [상태 관리 가이드](docs/sync-state.md)에 설명합니다.

## 실행

GitHub Actions의 **Discover organization repositories** 워크플로는 다음 조건으로 실행합니다.

- 매일 한국 시간 00:00, 02:00부터 22:00까지 2시간마다 실행합니다. GitHub의 UTC cron 표현식은 `0 1-23/2 * * *`입니다.
- Hub 저장소의 `master` 브랜치에 push되면 자동 실행합니다. 다른 사이드 프로젝트 저장소의 push는 예약 실행 때 반영합니다.
- Actions 화면에서 수동 실행할 수도 있습니다.

**Read default-branch project information** 단계에서 전체·수집·실패·빈 저장소·건너뜀 개수와 공개 저장소의 `project` 정보를 확인합니다. `project`에는 기본 브랜치, 기준 커밋 SHA, 루트 구조, 파일 경로·blob SHA·본문, 생략한 파일 목록이 포함됩니다. 파일이 원래 없으면 빈 배열이며 원문 오류는 출력하지 않습니다. HEAD가 같은 저장소는 `skipped: true`로 표시하며 `project` 본문을 다시 출력하지 않습니다.

로컬 실행은 `HUB_GITHUB_TOKEN` 환경 변수에 읽기 전용 설치 토큰을 설정한 다음 아래 명령을 사용합니다. 토큰 값을 명령 인자나 저장소 파일에 넣지 않습니다.

```sh
pnpm install --frozen-lockfile
HUB_GITHUB_TOKEN="$GITHUB_APP_INSTALLATION_TOKEN" \
HUB_STATE_TOKEN="$HUB_REPOSITORY_WRITE_TOKEN" \
HUB_STATE_REPOSITORY="YeonCheols/portfolio-hub" pnpm discover
```

## 검증 명령

```sh
pnpm lint
pnpm typecheck
pnpm test
```

수집 실패 이력은 `sync-state` 브랜치의 `state/failures/YYYY-MM-DD/failures.json`에 한국 시간 날짜별로 누적하며, 복구 후에도 보존합니다. 저장 항목과 브랜치 보호 정책은 [상태 저장 가이드](docs/sync-state.md)를 따릅니다.

## 프로젝트 문서 입력 계약

프로젝트 소개의 원본은 각 저장소 기본 브랜치 루트의 규격 `PROJECT.MD`입니다. 문서 형식을 강제하지 않으며 각 저장소에서 내용을 갱신합니다. 공통 조회 모듈과 각 프로젝트에 제안할 유지·갱신 지침은 [문서 입력 계약](docs/project-document.md)에 설명합니다. Hub는 AI 재생성 없이 규격 문서를 API에 전달할 수 있으며, 명시적으로 활성화한 경우에만 쓰기를 실행합니다.

## 중앙 프로젝트 지침 온보딩

Hub는 각 저장소의 PROJECT.MD·대표 이미지 유지 지침을 중앙 관리하고 동기화 실행 시 지침이 없거나 바뀐 저장소에 AGENTS.md 온보딩 PR을 제안합니다. 기존 지침을 보존하고 열린 PR은 중복 생성하지 않으며 담당자가 직접 머지합니다. 문서와 대표 이미지 생성·갱신은 각 저장소가 담당합니다.

config에서 `HUB_ONBOARDING_ENABLED=true`로 활성화하면 같은 App으로 Contents: write·Pull requests: write 설치 토큰을 별도 발급합니다. false면 기존 수집만 수행합니다. 권한·중복·실패·재시도 정책과 공통 지침 원본은 [프로젝트 문서 지침](docs/project-document.md#자동-온보딩-pr)을 따릅니다.

## 프로젝트 API 연결

각 저장소의 PROJECT.MD 첫 JSON 블록에서 제목·설명·slug·스택과 선택적인 공개 이미지 URL·링크를 읽고, 아래 마크다운을 본문으로 그대로 전송합니다. 공개 이미지 URL이 없으면 이미지 없이 등록합니다. Hub의 AI 생성·이미지 업로드는 없습니다.

config에 `HUB_PROJECT_SYNC_ENABLED=true`, `PORTFOLIO_API_URL=https://api.ycseng.com`을 설정하면 워크플로가 GitHub OIDC로 15분 access token을 발급받아 `PUT /service/project`를 호출합니다. 별도 서비스 ID·Secret이나 고정 서비스 토큰은 필요하지 않습니다. API는 GitHub 서명·issuer·audience·만료와 저장소 소유자 `YeonCheols`의 고정 ID(`91575756`)를 검증합니다. 같은 소유자의 모든 저장소 워크플로를 허용하는 정책이며 수집 대상 조직과는 구분합니다. API 반영 성공 SHA는 수집 SHA와 분리해 저장하므로 저장 실패를 다음 실행에서 재시도합니다. 문서가 없으면 반영 대기하며 기존 포트폴리오 항목을 삭제하지 않습니다. API 반영은 즉시 공개되고 관리자 편집 내용도 교체합니다.

문서 예시·선택 이미지·초기 설정·재시도 계약은 [프로젝트 문서 계약](docs/project-document.md)을 따릅니다.

토큰은 `$RUNNER_TEMP`의 권한 0600 임시 파일에만 보관합니다. 워크플로 종료 단계는 성공·실패와 관계없이 API 토큰 폐기를 시도한 뒤 파일을 삭제합니다. 강제 종료나 폐기 요청 실패 시에도 15분 만료가 적용됩니다. 토큰을 공개 `sync-state`, 캐시, artifact, 정적 설정에 저장하지 않습니다. GitHub OIDC와 API access token은 Actions 로그에서 마스킹합니다. API의 OIDC 교환·폐기 지원을 먼저 배포한 뒤 Hub 동기화를 활성화합니다.

중앙 설정 이관 순서는 config 변경 머지 → `cli-v0.3.0` 릴리스 성공 확인 → Hub 변경 머지 → 워크플로 실행 확인 → 이전 `HUB_GITHUB_APP_CLIENT_ID`, `HUB_GITHUB_APP_PRIVATE_KEY`, `HUB_ONBOARDING_ENABLED`, `HUB_PROJECT_SYNC_ENABLED`, `PORTFOLIO_API_URL` Actions 설정 삭제입니다. 이전 워크플로가 이 값을 사용 중일 때 먼저 삭제하지 않습니다.
