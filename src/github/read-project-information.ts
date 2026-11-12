import type { Octokit } from "@octokit/rest";
import type { OrganizationRepository } from "./list-organization-repositories.js";
import {
  ORGANIZATION,
  GitHubDiscoveryError,
  toSafeDiscoveryError,
} from "./list-organization-repositories.js";

export type ProjectInformation = {
  state: "ready" | "empty";
  defaultBranch: string;
  commitSha: string | null;
  entries: { path: string; type: string }[];
  files: { path: string; sha: string; content: string }[];
  skippedFiles: string[];
};

const manifests = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "pubspec.yaml",
  "Package.swift",
]);
const isProjectFile = (name: string): boolean =>
  /^readme(?:\.(?:md|mdx|rst|txt))?$/i.test(name) ||
  manifests.has(name) ||
  /\.(?:csproj|fsproj|sln)$/.test(name);

export const resolveDefaultBranchHead = async (
  client: Pick<Octokit, "request">,
  repository: OrganizationRepository,
): Promise<string | null> => {
  try {
    const base = { owner: ORGANIZATION, repo: repository.name };
    const commit = await client
      .request("GET /repos/{owner}/{repo}/commits/{ref}", {
        ...base,
        ref: repository.defaultBranch,
      })
      .catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 409
        )
          return null;
        throw error;
      });
    return commit?.data.sha ?? null;
  } catch (error) {
    throw toSafeDiscoveryError(error);
  }
};

export const readProjectInformation = async (
  client: Pick<Octokit, "request">,
  repository: OrganizationRepository,
  resolvedHead?: string | null,
): Promise<ProjectInformation> => {
  try {
    const base = { owner: ORGANIZATION, repo: repository.name };
    const ref =
      resolvedHead === undefined
        ? await resolveDefaultBranchHead(client, repository)
        : resolvedHead;
    if (ref === null)
      return {
        state: "empty",
        defaultBranch: repository.defaultBranch,
        commitSha: null,
        entries: [],
        files: [],
        skippedFiles: [],
      };
    const root = await client.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { ...base, path: "", ref },
    );
    if (!Array.isArray(root.data))
      throw new GitHubDiscoveryError("REQUEST_FAILED");
    const result: ProjectInformation = {
      state: "ready",
      defaultBranch: repository.defaultBranch,
      commitSha: ref,
      entries: root.data.map((entry) => ({
        path: entry.path,
        type: entry.type,
      })),
      files: [],
      skippedFiles: [],
    };
    let totalBytes = 0;
    for (const entry of root.data) {
      if (entry.type !== "file" || !isProjectFile(entry.name)) continue;
      if (
        entry.size > 256 * 1024 ||
        totalBytes + entry.size > 1024 * 1024 ||
        result.files.length >= 30
      ) {
        result.skippedFiles.push(entry.path);
        continue;
      }
      const response = await client.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        { ...base, path: entry.path, ref },
      );
      const data = response.data;
      if (
        Array.isArray(data) ||
        data.type !== "file" ||
        !("encoding" in data) ||
        data.encoding !== "base64" ||
        typeof data.content !== "string"
      )
        throw new GitHubDiscoveryError("REQUEST_FAILED");
      const decoded = Buffer.from(data.content, "base64");
      if (
        decoded.length > 256 * 1024 ||
        totalBytes + decoded.length > 1024 * 1024
      ) {
        result.skippedFiles.push(entry.path);
        continue;
      }
      totalBytes += decoded.length;
      result.files.push({
        path: entry.path,
        sha: data.sha,
        content: decoded.toString("utf8"),
      });
    }
    return result;
  } catch (error) {
    throw toSafeDiscoveryError(error);
  }
};
