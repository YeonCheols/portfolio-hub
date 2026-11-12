import {
  applyProject,
  type ProjectPublisher,
} from "./portfolio-api/application.js";
import {
  createPortfolioApiClient,
  PortfolioApiError,
} from "./portfolio-api/client.js";
import {
  readWorkflowAccessToken,
  workflowTokenPath,
} from "./portfolio-api/workflow-auth.js";
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
import {
  readProjectInformation,
  resolveDefaultBranchHead,
} from "./github/read-project-information.js";
import type { ProjectInformation } from "./github/read-project-information.js";
import {
  shouldSkip,
  StateStorageError,
  type StateStore,
  type RepositoryState,
  type FailureRecord,
} from "./sync/state.js";
import { ensureProjectGuidance } from "./project-document/onboarding.js";
import { createGitHubStateStore } from "./sync/github-state-store.js";

export type DiscoveryCliDependencies = {
  token: string | undefined;
  stateStore: StateStore;
  requireProjectSync?: boolean;
  projectPublisher?: ProjectPublisher;
  requireOnboarding?: boolean;
  onboardingClient?: Pick<OctokitClient, "request" | "paginate">;
  now?: () => string;
  createClient: (token: string) => Pick<OctokitClient, "paginate" | "request">;
  writeOutput: (message: string) => void;
  writeError: (message: string) => void;
};

export const runDiscoveryCli = async (
  dependencies: DiscoveryCliDependencies,
): Promise<number> => {
  const { token, createClient, writeOutput, writeError, projectPublisher } =
    dependencies;

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

  if (dependencies.requireOnboarding && !dependencies.onboardingClient) {
    writeError(
      JSON.stringify({
        error: {
          code: "MISSING_ONBOARDING_TOKEN",
          message: "Onboarding writer token is required when enabled",
        },
      }),
    );
    return 1;
  }

  if (dependencies.requireProjectSync && !projectPublisher) {
    writeError(
      JSON.stringify({
        error: {
          code: "PORTFOLIO_API_CONFIGURATION_INVALID",
          message: "Portfolio API operation failed",
        },
      }),
    );
    return 1;
  }

  try {
    const state = await dependencies.stateStore.load().catch(() => {
      throw new StateStorageError();
    });
    const now = dependencies.now ?? (() => new Date().toISOString());
    const client = createClient(token);
    const repositories = await listOrganizationRepositories(client);
    const publicRepositories: (OrganizationRepository & {
      project?: ProjectInformation;
      error?: { code: string; message: string };
      skipped?: boolean;
    })[] = [];
    const failures: FailureRecord[] = [];
    const onboarding = {
      created: 0,
      pending: 0,
      closed: 0,
      current: 0,
      skipped: 0,
      failed: 0,
    };
    const slugOwners = new Map<string, string>();
    if (projectPublisher) {
      for (const [id, application] of Object.entries(
        state.applications ?? {},
      )) {
        if (
          application.targetHash !== projectPublisher.targetHash ||
          application.slug === null
        )
          continue;
        if (
          slugOwners.has(application.slug) &&
          slugOwners.get(application.slug) !== id
        )
          throw new StateStorageError();
        slugOwners.set(application.slug, id);
      }
    }
    const projectSync = { success: 0, failure: 0, pending: 0, skipped: 0 };
    let projectReadCount = 0;
    let failedRepositoryCount = 0;
    let emptyRepositoryCount = 0;
    let skippedRepositoryCount = 0;
    for (const repository of repositories) {
      const id = String(repository.id);
      const previous = state.repositories[id];
      const identity = {
        repositoryId: repository.id,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      };
      let head: string | null = null;
      const failed = (code: string): RepositoryState => {
        failures.push({ ...identity, headSha: head, failedAt: now(), code });
        return {
          ...identity,
          lastSuccessfulHeadSha: previous?.lastSuccessfulHeadSha ?? null,
          lastSuccessfulAt: previous?.lastSuccessfulAt ?? null,
          lastResult: "failure",
          lastErrorCode: code,
        };
      };
      try {
        head = await resolveDefaultBranchHead(client, repository);
        if (dependencies.onboardingClient && head !== null) {
          try {
            const result = await ensureProjectGuidance(
              client,
              dependencies.onboardingClient,
              repository,
              head,
            );
            onboarding[result]++;
          } catch {
            onboarding.failed++;
          }
        } else if (dependencies.onboardingClient) {
          onboarding.skipped++;
        }
        if (projectPublisher) {
          const application = await applyProject(
            client,
            repository,
            head,
            state.applications?.[id],
            {
              targetHash: projectPublisher.targetHash,
              upsert: async (payload) => {
                const owner = slugOwners.get(payload.slug);
                if (owner !== undefined && owner !== id)
                  throw new PortfolioApiError("PORTFOLIO_API_INVALID_INPUT");
                slugOwners.set(payload.slug, id);
                return projectPublisher.upsert(payload);
              },
            },
            now,
          );
          projectSync[application.result]++;
          if (application.state) {
            state.applications ??= {};
            state.applications[id] = application.state;
          }
        }
        if (previous && shouldSkip(previous, head)) {
          state.repositories[id] = {
            ...previous,
            ...identity,
            lastResult: "success",
            lastErrorCode: null,
          };
          skippedRepositoryCount++;
          if (repository.visibility === "public")
            publicRepositories.push({ ...repository, skipped: true });
          continue;
        }
        const project = await readProjectInformation(client, repository, head);
        projectReadCount++;
        if (project.state === "empty") {
          emptyRepositoryCount++;
          state.repositories[id] = failed("EMPTY_REPOSITORY");
        } else if (project.skippedFiles.length > 0) {
          failedRepositoryCount++;
          state.repositories[id] = failed("CONTENT_INCOMPLETE");
        } else {
          state.repositories[id] = {
            ...identity,
            lastSuccessfulHeadSha: head,
            lastSuccessfulAt: now(),
            lastResult: "success",
            lastErrorCode: null,
          };
        }
        if (repository.visibility === "public")
          publicRepositories.push({ ...repository, project });
      } catch (error) {
        failedRepositoryCount++;
        const safeError = toSafeDiscoveryError(error);
        state.repositories[id] = failed(safeError.code);
        if (repository.visibility === "public")
          publicRepositories.push({
            ...repository,
            error: { code: safeError.code, message: safeError.message },
          });
      }
    }
    await (
      failures.length > 0
        ? dependencies.stateStore.save(state, failures)
        : dependencies.stateStore.save(state)
    ).catch(() => {
      throw new StateStorageError();
    });
    writeOutput(
      JSON.stringify(
        {
          organization: ORGANIZATION,
          ...(projectPublisher ? { projectSync } : {}),
          ...(dependencies.onboardingClient ? { onboarding } : {}),
          repositoryCount: repositories.length,
          projectReadCount,
          failedRepositoryCount,
          emptyRepositoryCount,
          skippedRepositoryCount,
          publicRepositories,
          restrictedRepositoryCount:
            repositories.length - publicRepositories.length,
        },
        null,
        2,
      ),
    );
    return failedRepositoryCount > 0 ||
      onboarding.failed > 0 ||
      projectSync.failure > 0
      ? 1
      : 0;
  } catch (error) {
    const safeError =
      error instanceof GitHubDiscoveryError ||
      error instanceof StateStorageError
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
  const stateToken = process.env.HUB_STATE_TOKEN;
  const stateRepository = process.env.HUB_STATE_REPOSITORY;
  if (!stateToken || !stateRepository) {
    console.error(
      JSON.stringify({
        error: {
          code: "MISSING_STATE_CONFIGURATION",
          message: "Hub state token and repository are required",
        },
      }),
    );
    process.exitCode = 1;
  } else {
    try {
      const exitCode = await runDiscoveryCli({
        token: process.env.HUB_GITHUB_TOKEN,
        requireProjectSync: process.env.HUB_PROJECT_SYNC_ENABLED === "true",
        projectPublisher:
          process.env.HUB_PROJECT_SYNC_ENABLED === "true"
            ? createPortfolioApiClient({
                baseUrl: process.env.PORTFOLIO_API_URL ?? "",
                accessToken: await readWorkflowAccessToken(
                  workflowTokenPath(process.env),
                ),
              })
            : undefined,
        requireOnboarding: process.env.HUB_ONBOARDING_ENABLED === "true",
        onboardingClient:
          process.env.HUB_ONBOARDING_ENABLED === "true" &&
          process.env.HUB_ONBOARDING_TOKEN?.trim()
            ? new Octokit({
                auth: process.env.HUB_ONBOARDING_TOKEN,
                log: silentLogger,
              })
            : undefined,
        stateStore: createGitHubStateStore(
          new Octokit({ auth: stateToken, log: silentLogger }),
          stateRepository,
        ),
        createClient: (token) =>
          new Octokit({ auth: token, log: silentLogger }),
        writeOutput: (message) => console.log(message),
        writeError: (message) => console.error(message),
      });

      process.exitCode = exitCode;
    } catch (cause) {
      const error =
        cause instanceof PortfolioApiError ? cause : new StateStorageError();
      console.error(
        JSON.stringify({ error: { code: error.code, message: error.message } }),
      );
      process.exitCode = 1;
    }
  }
}
