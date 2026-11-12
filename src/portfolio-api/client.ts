import { createHash } from "node:crypto";
export type ProjectPayload = {
  slug: string;
  title: string;
  description: string;
  image: string;
  stacks: string;
  content: string;
  linkDemo?: string | null;
  linkGithub?: string | null;
};
export type PortfolioApiResult = {
  operation: "created" | "updated" | "unchanged";
  projectId: number;
  slug: string;
};
export type PortfolioApiOptions = {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
};

export type PortfolioApiErrorCode =
  | "PORTFOLIO_API_AUTH_FAILED"
  | "PORTFOLIO_API_REQUEST_FAILED"
  | "PORTFOLIO_API_INVALID_RESPONSE"
  | "PORTFOLIO_API_INVALID_INPUT"
  | "PORTFOLIO_API_CONFIGURATION_INVALID";
export class PortfolioApiError extends Error {
  constructor(readonly code: PortfolioApiErrorCode) {
    super("Portfolio API operation failed");
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const createPortfolioApiClient = (options: PortfolioApiOptions) => {
  let url: URL;
  try {
    url = new URL(options.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !/^[^\s]+$/.test(options.accessToken ?? "")
    )
      throw new Error();
  } catch {
    throw new PortfolioApiError("PORTFOLIO_API_CONFIGURATION_INVALID");
  }
  const baseUrl = url.origin;
  const request = options.fetch ?? fetch;
  return {
    targetHash: createHash("sha256")
      .update(`project-contract-v1:${baseUrl}`)
      .digest("hex"),
    upsert: async (payload: ProjectPayload): Promise<PortfolioApiResult> => {
      try {
        const response = await request(`${baseUrl}/service/project`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.accessToken}`,
          },
          body: JSON.stringify(payload),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          throw new PortfolioApiError(
            response.status === 401 || response.status === 403
              ? "PORTFOLIO_API_AUTH_FAILED"
              : "PORTFOLIO_API_REQUEST_FAILED",
          );
        }
        const result: unknown = await response.json();
        if (
          !object(result) ||
          (result.operation !== "created" &&
            result.operation !== "updated" &&
            result.operation !== "unchanged") ||
          !object(result.project) ||
          !Number.isSafeInteger(result.project.id) ||
          typeof result.project.id !== "number" ||
          result.project.id <= 0 ||
          result.project.slug !== payload.slug
        )
          throw new PortfolioApiError("PORTFOLIO_API_INVALID_RESPONSE");
        return {
          operation: result.operation,
          projectId: result.project.id,
          slug: payload.slug,
        };
      } catch (error) {
        throw error instanceof PortfolioApiError
          ? error
          : new PortfolioApiError("PORTFOLIO_API_REQUEST_FAILED");
      }
    },
  };
};
