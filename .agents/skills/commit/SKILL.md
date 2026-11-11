---
name: commit
description: 변경사항을 검토·검증한 뒤 이 저장소의 컨벤션(Conventional Commits, commitlint)으로 커밋한다. 사용자가 커밋, 커밋 메시지 작성, 커밋 후 푸시를 요청할 때 사용한다.
disable-model-invocation: true
---

# Commit

## 절차

```
- [ ] 1. 상태 파악: git status, git diff, git diff --staged, git log --oneline -10
- [ ] 2. 커밋 대상 선별 (관련 없는 변경/민감 파일 제외)
- [ ] 3. 검증: pnpm lint, 변경 범위 관련 pnpm test
- [ ] 4. 논리 단위로 스테이징 (git add <파일>; git add -A 지양)
- [ ] 5. 코드 리뷰: review 스킬 staged 모드 (git diff --staged) → 🔴 있으면 커밋 중단 후 보고
- [ ] 6. 커밋 메시지 작성 및 커밋
- [ ] 7. git status로 결과 확인, 요청 시에만 푸시
```

5단계는 `src/`, `.github/workflows/` 변경이 스테이징된 경우 필수다. 문서(`*.md`)만 커밋할 때는 생략할 수 있고, 생략했다고 보고한다.

- 리뷰는 이슈 목적, 데이터 흐름, 공통 소유권과 불변조건을 포함하는 `review` 스킬의 기준을 따릅니다. 차단 검증 보류는 커밋하지 않고 보고합니다. 실제 MCP 서버 배포와 배포 후 확인은 로컬 MCP 검증을 대체하지 않으며 비차단 후속 제안으로 기록합니다.
- 리뷰에서 확인된 문제를 사용자 요청으로 수정했다면 최신 스테이징 상태의 목적·변경·주변 영향·검증을 다시 확인한 뒤 커밋합니다. 커밋 후에도 실제 HEAD와 리뷰 대상의 일치를 확인하고, 훅 변경 등 차이가 있으면 영향 범위를 재검토합니다. 자동 수정·커밋 반복 루프는 실행하지 않습니다.

## 커밋 대상 제외

- `.env*`, `cert/`, `.vercel/`, `.next/`, `docs/api.ts`(생성물), `.DS_Store`, 비밀값이 포함된 파일
- 사용자가 작업 중인 무관한 변경 (건드리지 말고 그대로 둔다)
- 위 파일이 스테이징돼 있으면 커밋 전 사용자에게 알린다

## 메시지 형식

`commitlint.config.js`와 `docs/COMMIT_CONVENTION.md`를 따른다.

```
<type>(<scope>): <제목>

<선택: 본문. 왜 바꿨는지. 72자 줄바꿈>
```

- type: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- scope는 선택. feature 이름이나 영역을 쓴다 (`about`, `blog`, `dashboard`)
- 제목은 100자 이내, 마침표 없음, 영문은 소문자로 시작
- 서로 다른 목적의 변경은 커밋을 분리한다

예시:

```
feat(about): 소개와 학력 정보를 갱신
fix(dashboard): github api 인증 실패를 빈 데이터로 처리
chore: 에이전트 지침과 스킬을 추가
```

## 커밋 실행

여러 줄 메시지는 HEREDOC 사용:

```bash
git commit -m "$(cat <<'EOF'
feat(about): 소개와 학력 정보를 갱신

이력서 기준으로 교육 과정과 소개 문구를 맞춘다
EOF
)"
```

## 금지 사항

- `--no-verify`, `--amend`(사용자 요청 없을 때), `git push --force`
- `master`에 직접 커밋/푸시 — 현재 브랜치가 `master`면 멈추고 사용자에게 확인
- 검증 실패 상태로 커밋 — 실패 내용을 보고하고 사용자 판단을 받는다
- `pnpm lint:fix`는 내부에서 `yarn format`을 호출하므로 쓰지 않는다. 포맷은 `pnpm format`을 쓴다

## 푸시 (요청 시)

`git push` (업스트림 없으면 `git push -u origin <branch>`). 결과의 커밋 해시와 브랜치를 보고한다.
