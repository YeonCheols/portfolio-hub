import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import {
  ORGANIZATION,
  type OrganizationRepository,
} from "../github/list-organization-repositories.js";
import { GUIDANCE_START, GUIDANCE_END, PROJECT_GUIDANCE } from "./guidance.js";

export type OnboardingResult =
  "created" | "pending" | "closed" | "current" | "skipped";
export class OnboardingError extends Error {
  readonly code = "ONBOARDING_FAILED";
  constructor() {
    super("Repository guidance onboarding failed");
  }
}
const notFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

export const ensureProjectGuidance = async (
  reader: Pick<Octokit, "request">,
  writer: Pick<Octokit, "request" | "paginate">,
  repository: OrganizationRepository,
  headSha: string,
): Promise<OnboardingResult> => {
  try {
    const repo = repository.name;
    const owner = ORGANIZATION;
    if (repository.fullName !== `${owner}/${repo}` || !/^[\w.-]+$/.test(repo))
      throw new OnboardingError();
    if (repository.archived || repository.fork) return "skipped";
    let original = "";
    let originalSha: string | null = null;
    try {
      const { data } = await reader.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner, repo, path: "AGENTS.md", ref: headSha },
      );
      if (
        Array.isArray(data) ||
        data.type !== "file" ||
        "target" in data ||
        "submodule_git_url" in data ||
        !("encoding" in data) ||
        data.encoding !== "base64" ||
        typeof data.content !== "string" ||
        data.size > 64 * 1024
      )
        throw new OnboardingError();
      originalSha = data.sha;
      const bytes = Buffer.from(data.content, "base64");
      if (bytes.length > 64 * 1024) throw new OnboardingError();
      original = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      if (!notFound(error)) throw error;
    }
    const start = original.indexOf(GUIDANCE_START);
    const end = original.indexOf(GUIDANCE_END);
    if (
      (start >= 0 || end >= 0) &&
      (start < 0 ||
        end < start ||
        original.indexOf(GUIDANCE_START, start + 1) >= 0 ||
        original.indexOf(GUIDANCE_END, end + 1) >= 0)
    )
      throw new OnboardingError();
    if (original.includes(PROJECT_GUIDANCE)) return "current";
    const content =
      start >= 0 && end > start
        ? original.slice(0, start) +
          PROJECT_GUIDANCE +
          original.slice(end + GUIDANCE_END.length)
        : `${original}${original.endsWith("\n") || !original ? "" : "\n"}\n${PROJECT_GUIDANCE}\n`;
    const hash = createHash("sha256")
      .update(PROJECT_GUIDANCE)
      .digest("hex")
      .slice(0, 16);
    const branch = `portfolio-hub/project-guidance-${hash}`;
    const pulls = await writer.paginate("GET /repos/{owner}/{repo}/pulls", {
      owner,
      repo,
      state: "open",
      per_page: 100,
    });
    if (
      pulls.some(
        (pull) =>
          pull.head.ref.startsWith("portfolio-hub/project-guidance-") &&
          pull.head.repo?.full_name === repository.fullName &&
          pull.body?.includes("<!-- portfolio-hub:project-guidance -->"),
      )
    )
      return "pending";
    const closed = await writer.paginate("GET /repos/{owner}/{repo}/pulls", {
      owner,
      repo,
      state: "closed",
      head: `${owner}:${branch}`,
      per_page: 100,
    });
    if (closed.length > 0) return "closed";
    const commit = await reader.request(
      "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
      { owner, repo, commit_sha: headSha },
    );
    const root = await reader.request(
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      { owner, repo, tree_sha: commit.data.tree.sha },
    );
    const entry = root.data.tree.find((item) => item.path === "AGENTS.md");
    if (
      root.data.truncated ||
      (originalSha === null
        ? entry !== undefined
        : !entry ||
          entry.type !== "blob" ||
          !["100644", "100755"].includes(entry.mode ?? "") ||
          entry.sha !== originalSha)
    )
      throw new OnboardingError();
    const tree = await writer.request("POST /repos/{owner}/{repo}/git/trees", {
      owner,
      repo,
      base_tree: commit.data.tree.sha,
      tree: [
        {
          path: "AGENTS.md",
          mode: entry?.mode === "100755" ? "100755" : "100644",
          type: "blob",
          content,
        },
      ],
    });
    const existingBranch = await writer
      .request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
        owner,
        repo,
        ref: `heads/${branch}`,
      })
      .catch((error: unknown) => {
        if (notFound(error)) return undefined;
        throw error;
      });
    if (existingBranch) {
      const existingCommit = await writer.request(
        "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
        { owner, repo, commit_sha: existingBranch.data.object.sha },
      );
      if (
        existingCommit.data.tree.sha !== tree.data.sha ||
        existingCommit.data.parents.length !== 1 ||
        existingCommit.data.parents[0].sha !== headSha
      )
        throw new OnboardingError();
    } else {
      const update = await writer.request(
        "POST /repos/{owner}/{repo}/git/commits",
        {
          owner,
          repo,
          message: "docs: 프로젝트 문서와 대표 이미지 관리 지침 추가",
          tree: tree.data.sha,
          parents: [headSha],
        },
      );
      await writer.request("POST /repos/{owner}/{repo}/git/refs", {
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: update.data.sha,
      });
    }
    await writer.request("POST /repos/{owner}/{repo}/pulls", {
      owner,
      repo,
      base: repository.defaultBranch,
      head: branch,
      title: "docs: 프로젝트 문서와 대표 이미지 관리 지침을 추가합니다",
      body: "<!-- portfolio-hub:project-guidance -->\nHub에서 관리하는 공통 지침을 제안합니다. 기존 AGENTS.md를 보존하며 기본 브랜치를 직접 수정하거나 자동 머지하지 않습니다.\n\nPROJECT.md와 PROJECT.png의 생성·유지는 이 저장소가 담당합니다. 이 PR 자체는 문서·이미지를 생성하지 않습니다. 기존 지침과 충돌 여부 및 공개 가능 정보를 검토한 뒤 직접 머지해 주세요.",
    });
    return "created";
  } catch {
    throw new OnboardingError();
  }
};
