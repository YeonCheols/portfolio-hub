# Portfolio Hub

`side-projects-labs` Organization의 전체 저장소를 GitHub App으로 조회하고, 저장소 ID와 기본 메타데이터를 확인하는 중앙 실행 저장소입니다.

현재 범위는 조직 전체 저장소 탐색과 기본 브랜치의 프로젝트 정보 수집입니다. portfolio-api 프로젝트 생성·갱신, AI 문서 생성과 공개 승인은 후속 범위입니다.

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

GitHub App을 `side-projects-labs` Organization의 전체 저장소에 설치하고 Repository permissions에 `Metadata: read-only`와 `Contents: read-only`를 부여합니다. 두 권한은 저장소 목록 및 기본 브랜치 파일 조회에 사용합니다.

App 등록 권한을 변경한 뒤에는 Organization의 설치 설정에서도 새 권한을 승인해야 합니다. 워크플로는 설치 토큰에 `metadata: read`와 `contents: read`를 명시적으로 요청하므로 승인 전에는 토큰 발급이 실패할 수 있습니다.

`portfolio-hub` 저장소 Actions 설정에 다음 값을 등록합니다.

- Repository variable `HUB_GITHUB_APP_CLIENT_ID`: GitHub App Client ID입니다.
- Repository secret `HUB_GITHUB_APP_PRIVATE_KEY`: GitHub App private key 원문입니다.

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
