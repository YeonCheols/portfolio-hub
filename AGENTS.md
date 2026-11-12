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
