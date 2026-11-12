import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { OrganizationRepository } from "../github/list-organization-repositories.js";
import type { ProjectPayload, PortfolioApiResult } from "./client.js";
import {
  readProjectDocument,
  ProjectDocumentError,
} from "../project-document/read-document.js";
import {
  parseProjectDocument,
  ProjectContractError,
} from "../project-document/parse-document.js";
import { PortfolioApiError } from "./client.js";
import type { ApplicationState } from "../sync/state.js";
export type ProjectPublisher = {
  targetHash: string;
  upsert: (payload: ProjectPayload) => Promise<PortfolioApiResult>;
};
export const applyProject = async (
  reader: Pick<Octokit, "request">,
  repository: OrganizationRepository,
  head: string | null,
  previous: ApplicationState | undefined,
  publisher: ProjectPublisher,
  now: () => string,
): Promise<{
  result: "success" | "failure" | "pending" | "skipped";
  state?: ApplicationState;
}> => {
  if (head === null || repository.archived || repository.fork)
    return { result: "skipped" };
  if (
    previous?.targetHash === publisher.targetHash &&
    previous.lastSuccessfulHeadSha === head
  )
    return {
      result: "skipped",
      state: { ...previous, lastResult: "success", lastErrorCode: null },
    };
  try {
    const document = await readProjectDocument(reader, repository, head);
    const payload = parseProjectDocument(document.markdown);
    await publisher.upsert(payload);
    return {
      result: "success",
      state: {
        repositoryId: repository.id,
        slug: payload.slug,
        targetHash: publisher.targetHash,
        lastSuccessfulHeadSha: head,
        lastSuccessfulAt: now(),
        payloadHash: createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex"),
        lastResult: "success",
        lastErrorCode: null,
      },
    };
  } catch (error) {
    const code =
      error instanceof PortfolioApiError ||
      error instanceof ProjectDocumentError ||
      error instanceof ProjectContractError
        ? error.code
        : "REQUEST_FAILED";
    const result = code === "PROJECT_DOCUMENT_MISSING" ? "pending" : "failure";
    return {
      result,
      state: {
        repositoryId: repository.id,
        slug: previous?.slug ?? null,
        targetHash: previous?.targetHash ?? publisher.targetHash,
        lastSuccessfulHeadSha: previous?.lastSuccessfulHeadSha ?? null,
        lastSuccessfulAt: previous?.lastSuccessfulAt ?? null,
        payloadHash: previous?.payloadHash ?? null,
        lastResult: result,
        lastErrorCode: code,
      },
    };
  }
};
