import type { Octokit } from "@octokit/rest";

export const ORGANIZATION = "side-projects-labs";

export type OrganizationRepository = {
  id: number;
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  visibility: "public" | "private" | "internal";
  archived: boolean;
  fork: boolean;
  pushedAt: string | null;
};

export type GitHubDiscoveryErrorCode =
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "REQUEST_FAILED";

const safeErrorMessages: Record<GitHubDiscoveryErrorCode, string> = {
  AUTHENTICATION_FAILED: "GitHub authentication failed",
  PERMISSION_DENIED: "GitHub repository access denied",
  RATE_LIMITED: "GitHub API rate limit reached",
  REQUEST_FAILED: "GitHub repository discovery failed",
};

export class GitHubDiscoveryError extends Error {
  constructor(readonly code: GitHubDiscoveryErrorCode) {
    super(safeErrorMessages[code]);
    this.name = "GitHubDiscoveryError";
  }
}

type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  visibility: "public" | "private" | "internal";
  archived: boolean;
  fork: boolean;
  pushed_at: string | null;
};

export const listOrganizationRepositories = async (
  octokit: Pick<Octokit, "paginate">,
): Promise<OrganizationRepository[]> => {
  let repositories: GitHubRepositoryResponse[];
  try {
    repositories = await octokit.paginate<GitHubRepositoryResponse>(
      "GET /orgs/{org}/repos",
      {
        org: ORGANIZATION,
        type: "all",
        per_page: 100,
      },
    );
  } catch (error) {
    throw toSafeDiscoveryError(error);
  }

  const uniqueRepositories = new Map<number, OrganizationRepository>();

  for (const repository of repositories) {
    if (uniqueRepositories.has(repository.id)) continue;

    uniqueRepositories.set(repository.id, {
      id: repository.id,
      name: repository.name,
      fullName: repository.full_name,
      url: repository.html_url,
      defaultBranch: repository.default_branch,
      visibility: repository.visibility,
      archived: repository.archived,
      fork: repository.fork,
      pushedAt: repository.pushed_at,
    });
  }

  return [...uniqueRepositories.values()];
};

const toSafeDiscoveryError = (error: unknown): GitHubDiscoveryError => {
  const response = getErrorResponse(error);

  if (response?.status === 401) {
    return new GitHubDiscoveryError("AUTHENTICATION_FAILED");
  }

  if (response?.status === 429) {
    return new GitHubDiscoveryError("RATE_LIMITED");
  }

  if (response?.status === 403) {
    const headers = response.headers ?? {};
    const errorMessage = getErrorMessage(error).toLowerCase();
    if (
      headers["retry-after"] ||
      headers["x-ratelimit-remaining"] === "0" ||
      errorMessage.includes("rate limit")
    ) {
      return new GitHubDiscoveryError("RATE_LIMITED");
    }
    return new GitHubDiscoveryError("PERMISSION_DENIED");
  }

  return new GitHubDiscoveryError("REQUEST_FAILED");
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
};

const getErrorResponse = (
  error: unknown,
):
  | { status?: number; headers?: Record<string, string | undefined> }
  | undefined => {
  if (!error || typeof error !== "object" || !("response" in error))
    return undefined;

  const response = error.response;
  if (!response || typeof response !== "object") return undefined;

  const { status, headers } = response as {
    status?: unknown;
    headers?: unknown;
  };

  return {
    status: typeof status === "number" ? status : undefined,
    headers:
      headers && typeof headers === "object"
        ? (headers as Record<string, string | undefined>)
        : undefined,
  };
};
