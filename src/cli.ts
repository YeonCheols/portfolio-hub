import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Octokit } from "@octokit/rest";
import type { Octokit as OctokitClient } from "@octokit/rest";

import {
  GitHubDiscoveryError,
  listOrganizationRepositories,
  ORGANIZATION,
} from "./github/list-organization-repositories.js";

export type DiscoveryCliDependencies = {
  token: string | undefined;
  createClient: (token: string) => Pick<OctokitClient, "paginate">;
  writeOutput: (message: string) => void;
  writeError: (message: string) => void;
};

export const runDiscoveryCli = async (
  dependencies: DiscoveryCliDependencies,
): Promise<number> => {
  const { token, createClient, writeOutput, writeError } = dependencies;

  if (!token?.trim()) {
    writeError(
      JSON.stringify({
        error: {
          code: "MISSING_GITHUB_APP_TOKEN",
          message: "GitHub App token is required",
        },
      }),
    );
    return 1;
  }

  try {
    const repositories = await listOrganizationRepositories(
      createClient(token),
    );
    const publicRepositories = repositories.filter(
      (repository) => repository.visibility === "public",
    );
    writeOutput(
      JSON.stringify(
        {
          organization: ORGANIZATION,
          repositoryCount: repositories.length,
          publicRepositories,
          restrictedRepositoryCount:
            repositories.length - publicRepositories.length,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    const safeError =
      error instanceof GitHubDiscoveryError
        ? error
        : new GitHubDiscoveryError("REQUEST_FAILED");

    writeError(
      JSON.stringify({
        error: {
          code: safeError.code,
          message: safeError.message,
        },
      }),
    );
    return 1;
  }
};

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  const exitCode = await runDiscoveryCli({
    token: process.env.HUB_GITHUB_TOKEN,
    createClient: (token) => new Octokit({ auth: token, log: silentLogger }),
    writeOutput: (message) => console.log(message),
    writeError: (message) => console.error(message),
  });

  process.exitCode = exitCode;
}
