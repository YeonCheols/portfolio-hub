# AGENTS.md

This repository is being initialized. Read the relevant skill in .agents/skills/<name>/SKILL.md before performing its workflow.

## Project setup

- Runtime: Node.js 24, TypeScript, pnpm 9, Octokit REST API, and Vitest.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm discover` are the repository commands.
- The GitHub organization is fixed as `side-projects-labs`; repository discovery must use the organization endpoint and paginate every result.
- The GitHub App and organization installation use `Metadata: read` and `Contents: read` across all repositories, including private/internal repositories. Resolve each repository's default branch HEAD once and use that commit SHA for every content read.
- Do not print tokens, raw GitHub errors, or names and URLs of private/internal repositories to Actions logs. CLI output may include public repository metadata and restricted repository counts.
- Current collection includes root README/project manifests and root directory entries. Only allowlisted text files are fetched; no environment files, lockfiles, arbitrary source execution, or dependency installation from scanned repositories is allowed. Per-repository failures must not stop the remaining repositories.
- Do not add portfolio-api writes, AI generation, or public publishing without the corresponding user-authorized scope.

## Project document contract

- Use the default branch root `PROJECT.MD` as the canonical project document. The user-authorized v1 contract uses a leading JSON code block for schemaVersion/slug/title/description/stacks and optional public image/demo/GitHub URLs, followed by a free-form Markdown body. Follow docs/project-document.md; do not require body headings or regenerate its content in Hub. Project-specific document creation remains owned by each repository; AI can supplement the document as a supporting stage.
- Read through `src/project-document/read-document.ts` at an already resolved HEAD SHA. Preserve source metadata and markdown without logging or persisting bodies. Do not substitute README or treat document collection as API application success. The user-authorized onboarding exception may propose AGENTS.md changes through a dedicated branch and a manually merged PR; never directly update a source default branch, PROJECT.MD, or image.
- Follow `docs/project-document.md` for the shared maintenance guideline to propose in each repository's AGENTS.md. Maintain and update PROJECT.MD when project content changes without imposing a common content template.
- The document reader scope stops at the markdown input contract. The user has authorized Hub service authentication and project create/update calls. Use the deployed portfolio-api contract, keep application checkpoints separate from collection, and do not perform AI generation or image upload in Hub.

## Sync state guide

- Persist synchronization metadata in this Hub repository, on the dedicated `sync-state` branch at `state/repositories.json`. Do not add a separate database, catalog repository, Supabase store, or encryption layer for this scope.
- The user explicitly permits public synchronization metadata, including private repository IDs, names/paths, default branches, HEAD SHAs, timestamps, and safe result codes. This permission does not allow publishing private source/README bodies, raw errors, tokens, or keys in state files or logs. Private repository details remain hidden in workflow logs.
- Store one record per GitHub repository ID. HEAD SHA equality with the last successful collection SHA is the skip criterion; timestamps are informational. Names/paths may change without creating a new identity.
- Current success means complete collection plus durable JSON persistence. Preserve the previous successful SHA/time on errors, empty repositories, or skipped/oversized files. Empty repositories are counted separately and rechecked on the next run; incomplete collections and API/storage failures fail the job.
- Keep collection checkpoints separate from API application checkpoints in the optional applications map; validate both schemas and preserve existing v1 states without resetting them. A collection checkpoint does not prove a draft was generated, saved, approved, or published.
- State records contain only the schema-defined metadata and safe result codes. Validate the schema before reading/writing. Fail on corrupt state, missing files in an existing state branch, unsupported versions, or write conflicts; never silently reset state or force-push.
- Bootstrap `sync-state` with an orphan commit containing only synchronization metadata when the branch is absent. Commit checkpoints and dated failure history atomically using the loaded state commit as parent and base tree; update the ref without force so concurrent changes fail. Commit only changed state. Preserve records for repositories missing from a scan; do not infer deletion or alter portfolio visibility.
- The collection installation token remains read-only, explicitly requesting Metadata: read and Contents: read. The user approved reusing the same organization App for a separate onboarding write token. Use the Hub job's `GITHUB_TOKEN` via `HUB_STATE_TOKEN` and `HUB_STATE_REPOSITORY` for state writes. Keep push triggers limited to `master`, retain the shared concurrency group, and never use state writes to trigger collection recursively.
- Add regression tests for unchanged SHA skips, failure retries, success checkpointing, schema validation, no-op saves, bootstrap and write conflicts. Do not execute code or install dependencies from scanned repositories.
- Record repository collection failures under `state/failures/YYYY-MM-DD/failures.json` on `sync-state`, using Asia/Seoul dates and UTC event timestamps. Append repository identity, attempted HEAD SHA (null if unresolved), failure time, and allowlisted error code only; retain history after recovery. Missing daily files can be created, but corrupt daily files must fail without overwrite. Do not delete historical daily directories.
- The active `sync-state protection` ruleset blocks branch deletion and non-fast-forward pushes while allowing normal workflow writes. Do not enable a full branch lock, PR requirements, or update restrictions that would block the current `GITHUB_TOKEN` writer.

## Available skills

- tdd: test-first implementation workflow.
- systematic-debugging: investigate the root cause before changing code.
- qa: verify changed behavior and report unrun checks.
- verification-before-completion: verify claims against fresh evidence.
- review: inspect purpose, data flow, ownership, invariants, and regressions.
- commit: prepare and create a repository-conventional commit.
- pr: create or update a pull request.
- issue: create and validate a GitHub issue.

The inherited commit, issue, pr, qa, review, and tdd skills originated in portfolio2; see .agents/skills/README.md. Do not assume their package commands, branch names, templates, GitHub checks, or CI integrations apply here. Check this repository's actual files and adapt the affected procedure before using it. Define repository conventions and required templates as part of the project bootstrap.

## Central repository onboarding

- `src/project-document/guidance.ts` owns the shared PROJECT.MD and PROJECT.png maintenance guidance. Metadata follows the v1 JSON contract and the Markdown body remains free-form. Initial document/image creation and later updates belong to the source repository; Hub never executes its code or image tools.
- Check AGENTS.md at the resolved default-branch SHA on every scan, including unchanged collection SHAs. Add or replace only the Hub-managed guidance block; preserve all other bytes. Reject invalid/duplicate markers, symlinks, invalid UTF-8, and oversized files. Skip archived repositories and forks.
- Propose onboarding through a dedicated branch and PR. Never merge automatically, force-update a ref, rewrite existing instructions, or interpret a PR as document/image creation or API application success. Semantic conflicts require repository-owner review.
- Deduplicate open onboarding PRs across guideline versions. Respect a closed PR for the same version rather than recreating it on each run. A matching orphaned branch can be reused only if its tree and parent match the current proposal; other branch conflicts fail safely.
- Keep discovery tokens read-only and state writes on the Hub GITHUB_TOKEN. The same organization App supplies a separate onboarding token with Metadata: read, Contents: write, Pull requests: write as authorized by the user. Activate via HUB_ONBOARDING_ENABLED=true in central worker configuration. Do not silently continue without writer authentication when explicitly enabled.
- Onboarding results are aggregate counts only, separate from collection checkpoints and failure history. Do not log private repository identities, existing AGENTS.md bodies, tokens, or raw API errors. A repository failure must not stop remaining repositories; onboarding failure still fails the run after collection state persistence.

## Project API application

- Each source repository AI owns the v1 PROJECT.MD metadata and body. Hub validates the fixed schema and sends it unchanged; it never regenerates content or uploads/reads image files. The source may retain PROJECT.png at its root and supplies an optional public image URL. Missing/null/empty image maps to an empty API image string and must not block publication.
- Use PORTFOLIO_API_URL and ephemeral GitHub OIDC token exchange only when HUB_PROJECT_SYNC_ENABLED=true. Never add fixed API service credentials. Refuse missing/unsafe configuration, preserve secrets in server/Actions context, and never log raw API responses or content. This opt-in call immediately publishes/replaces the specified slug as authorized by the user.
- Persist applications metadata atomically with collection state on sync-state. Only a verified API response advances the application SHA/time/hash; failures preserve prior successes and retry even if collection already skipped the SHA. Missing PROJECT.MD is pending, not successful application. Keep application errors out of the collection failure history.

## Central worker configuration

- Hub static configuration is owned by private portfolio-config at environments/worker/portfolio-hub/.env; do not create development/production worker copies.
- Use the version-pinned portfolio-config CLI without --env. Hub Actions retains only PORTFOLIO_CONFIG_READ_TOKEN as bootstrap authentication for the private config repository and release assets.
- Publish only allowlisted Hub values into the job environment and mask multiline App keys before use. Never copy bootstrap authentication into subsequent steps or log raw config.
- Preserve existing Actions variables/secrets until the central-config workflow is deployed and verified; then remove only superseded Hub settings.
