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

## Sync state guide

- Persist synchronization metadata in this Hub repository, on the dedicated `sync-state` branch at `state/repositories.json`. Do not add a separate database, catalog repository, Supabase store, or encryption layer for this scope.
- The user explicitly permits public synchronization metadata, including private repository IDs, names/paths, default branches, HEAD SHAs, timestamps, and safe result codes. This permission does not allow publishing private source/README bodies, raw errors, tokens, or keys in state files or logs. Private repository details remain hidden in workflow logs.
- Store one record per GitHub repository ID. HEAD SHA equality with the last successful collection SHA is the skip criterion; timestamps are informational. Names/paths may change without creating a new identity.
- Current success means complete collection plus durable JSON persistence. Preserve the previous successful SHA/time on errors, empty repositories, or skipped/oversized files. Empty repositories are counted separately and rechecked on the next run; incomplete collections and API/storage failures fail the job.
- Keep collection checkpoints separate from future AI-generation/API-application checkpoints. A collection checkpoint does not prove a draft was generated, saved, approved, or published.
- State records contain only the schema-defined metadata and safe result codes. Validate the schema before reading/writing. Fail on corrupt state, missing files in an existing state branch, unsupported versions, or write conflicts; never silently reset state or force-push.
- Bootstrap `sync-state` with an orphan commit containing only the state JSON when the branch is absent. Reuse the existing file blob SHA for optimistic updates and commit only changed state. Preserve records for repositories missing from a scan; do not infer deletion or alter portfolio visibility.
- The organization GitHub App remains read-only. Use the Hub job's `GITHUB_TOKEN` via `HUB_STATE_TOKEN` and `HUB_STATE_REPOSITORY` for state writes. Keep push triggers limited to `master`, retain the shared concurrency group, and never use state writes to trigger collection recursively.
- Add regression tests for unchanged SHA skips, failure retries, success checkpointing, schema validation, no-op saves, bootstrap and write conflicts. Do not execute code or install dependencies from scanned repositories.

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
