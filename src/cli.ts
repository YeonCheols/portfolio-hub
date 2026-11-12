import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Octokit } from "@octokit/rest";
import type { Octokit as OctokitClient } from "@octokit/rest";

import {
  GitHubDiscoveryError,
  listOrganizationRepositories,
  ORGANIZATION,
  toSafeDiscoveryError,
} from "./github/list-organization-repositories.js";
import type { OrganizationRepository } from "./github/list-organization-repositories.js";
import { readProjectInformation } from "./github/read-project-information.js";
import type { ProjectInformation } from "./github/read-project-information.js";

export type DiscoveryCliDependencies = {
  token: string | undefined;
  createClient: (token: string) => Pick<OctokitClient, "paginate" | "request">;
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
    const client = createClient(token);
    const repositories = await listOrganizationRepositories(client);
    const publicRepositories: (OrganizationRepository & {
      project?: ProjectInformation;
      error?: { code: string; message: string };
    })[] = [];
    let projectReadCount = 0;
    let failedRepositoryCount = 0;
    let emptyRepositoryCount = 0;
    for (const repository of repositories) {
      try {
        const project = await readProjectInformation(client, repository);
        projectReadCount++;
        if (project.state === "empty") emptyRepositoryCount++;
        if (repository.visibility === "public")
          publicRepositories.push({ ...repository, project });
      } catch (error) {
        failedRepositoryCount++;
        const safeError = toSafeDiscoveryError(error);
        if (repository.visibility === "public")
          publicRepositories.push({
            ...repository,
            error: { code: safeError.code, message: safeError.message },
          });
      }
    }
    writeOutput(
      JSON.stringify(
        {
          organization: ORGANIZATION,
          repositoryCount: repositories.length,
          projectReadCount,
          failedRepositoryCount,
          emptyRepositoryCount,
          publicRepositories,
          restrictedRepositoryCount:
            repositories.length - publicRepositories.length,
        },
        null,
        2,
      ),
    );
    return failedRepositoryCount > 0 ? 1 : 0;
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
