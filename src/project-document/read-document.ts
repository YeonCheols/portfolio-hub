import type { Octokit } from "@octokit/rest";
import {
  ORGANIZATION,
  toSafeDiscoveryError,
  type OrganizationRepository,
} from "../github/list-organization-repositories.js";
export class ProjectDocumentError extends Error {
  constructor(
    readonly code:
      | "PROJECT_DOCUMENT_MISSING"
      | "PROJECT_DOCUMENT_UNREADABLE"
      | "PROJECT_DOCUMENT_TOO_LARGE",
  ) {
    super("Project document could not be read");
    this.name = "ProjectDocumentError";
  }
}

export type ProjectDocument = {
  source: {
    repositoryId: number;
    fullName: string;
    defaultBranch: string;
    headSha: string;
    documentSha: string;
    path: "PROJECT.MD";
  };
  markdown: string;
};
export const readProjectDocument = async (
  client: Pick<Octokit, "request">,
  repository: OrganizationRepository,
  headSha: string,
): Promise<ProjectDocument> => {
  try {
    const response = await client.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: ORGANIZATION,
        repo: repository.name,
        path: "PROJECT.MD",
        ref: headSha,
      },
    );
    const data = response.data;
    if (
      Array.isArray(data) ||
      data.type !== "file" ||
      "target" in data ||
      "submodule_git_url" in data ||
      !("encoding" in data) ||
      data.encoding !== "base64" ||
      typeof data.content !== "string"
    )
      throw new ProjectDocumentError("PROJECT_DOCUMENT_UNREADABLE");
    if (data.size > 256 * 1024)
      throw new ProjectDocumentError("PROJECT_DOCUMENT_TOO_LARGE");
    const decoded = Buffer.from(data.content, "base64");
    if (decoded.length > 256 * 1024)
      throw new ProjectDocumentError("PROJECT_DOCUMENT_TOO_LARGE");
    let markdown: string;
    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    } catch {
      throw new ProjectDocumentError("PROJECT_DOCUMENT_UNREADABLE");
    }
    return {
      source: {
        repositoryId: repository.id,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        headSha,
        documentSha: data.sha,
        path: "PROJECT.MD",
      },
      markdown,
    };
  } catch (error) {
    if (error instanceof ProjectDocumentError) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 404
    )
      throw new ProjectDocumentError("PROJECT_DOCUMENT_MISSING");
    throw toSafeDiscoveryError(error);
  }
};
