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
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
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
      !options.clientId.trim() ||
      !options.clientSecret.trim()
    )
      throw new Error();
  } catch {
    throw new PortfolioApiError("PORTFOLIO_API_CONFIGURATION_INVALID");
  }
  const baseUrl = url.origin;
  const now = options.now ?? Date.now;
  let expiresAt = 0;
  const request = options.fetch ?? fetch;
  let token: string | undefined;
  const encode = (value: string) =>
    new URLSearchParams({ value }).toString().slice(6);
  return {
    targetHash: createHash("sha256")
      .update(`project-contract-v1:${baseUrl}`)
      .digest("hex"),
    upsert: async (payload: ProjectPayload): Promise<PortfolioApiResult> => {
      try {
        if (!token || now() >= expiresAt) {
          const issuedAt = now();
          const response = await request(`${baseUrl}/auth/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(`${encode(options.clientId)}:${encode(options.clientSecret)}`).toString("base64")}`,
            },
            body: new URLSearchParams({
              grant_type: "client_credentials",
              scope: "project:write",
            }),
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok)
            throw new PortfolioApiError("PORTFOLIO_API_AUTH_FAILED");
          const body: unknown = await response.json();
          if (
            !object(body) ||
            typeof body.access_token !== "string" ||
            !body.access_token ||
            body.token_type !== "Bearer" ||
            body.scope !== "project:write" ||
            typeof body.expires_in !== "number" ||
            body.expires_in <= 0 ||
            body.expires_in > 900
          )
            throw new PortfolioApiError("PORTFOLIO_API_INVALID_RESPONSE");
          token = body.access_token;
          expiresAt = issuedAt + body.expires_in * 1000 - 30000;
        }
        const response = await request(`${baseUrl}/service/project`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          if (response.status === 401) token = undefined;
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
