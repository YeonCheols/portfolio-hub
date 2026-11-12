# Portfolio Hub

`side-projects-labs` Organization의 전체 저장소를 GitHub App으로 조회하고, 저장소 ID와 기본 메타데이터를 확인하는 중앙 실행 저장소입니다.

현재 범위는 저장소 목록 탐색과 메타데이터 요약입니다. 저장소 콘텐츠 수집, portfolio-api 프로젝트 생성·갱신, AI 문서 생성과 공개 승인은 후속 범위입니다.

## 구성

- TypeScript와 Node.js에서 Octokit REST API를 사용합니다.
- `GET /orgs/side-projects-labs/repos`를 페이지네이션해 전체 결과를 조회합니다.
- GitHub 저장소 ID로 중복을 제거하고 이름, 전체 경로, URL, 기본 브랜치, 공개 범위, 보관·포크 여부, 마지막 푸시 시각을 반환합니다.
- Actions 로그에는 공개 저장소 메타데이터만 출력합니다. 비공개·내부 저장소는 전체 개수와 제한된 저장소 개수만 표시합니다.
- 인증·권한·rate limit·요청 실패는 고정된 코드와 메시지로 변환합니다. 원문 응답과 토큰은 출력하지 않습니다.

## GitHub App 설정

GitHub App을 `side-projects-labs` Organization에 설치하고 전체 저장소에 대해 Repository permissions의 `Metadata: read-only`만 부여합니다. 목록 조회 기능에는 코드 콘텐츠 권한이 필요하지 않습니다.

`portfolio-hub` 저장소 Actions 설정에 다음 값을 등록합니다.

- Repository variable `HUB_GITHUB_APP_CLIENT_ID`: GitHub App Client ID입니다.
- Repository secret `HUB_GITHUB_APP_PRIVATE_KEY`: GitHub App private key 원문입니다.

워크플로는 실행할 때 설치 토큰을 발급하고 job 종료 시 폐기합니다. 공개 저장소이므로 private key, 토큰, 비공개 저장소의 이름과 URL을 로그에 출력하지 않습니다.

## 실행

GitHub Actions의 **Discover organization repositories** 워크플로를 수동 실행합니다. 결과에는 전체 저장소 수, 공개 저장소 목록, 비공개·내부 저장소 수가 출력됩니다. 현재 `portfolio-admin` 저장소가 공개 상태라면 목록에서 확인할 수 있습니다.

로컬 실행은 `HUB_GITHUB_TOKEN` 환경 변수에 읽기 전용 설치 토큰을 설정한 다음 아래 명령을 사용합니다. 토큰 값을 명령 인자나 저장소 파일에 넣지 않습니다.

```sh
pnpm install --frozen-lockfile
HUB_GITHUB_TOKEN="$GITHUB_APP_INSTALLATION_TOKEN" pnpm discover
```

## 검증 명령

```sh
pnpm lint
pnpm typecheck
pnpm test
```
