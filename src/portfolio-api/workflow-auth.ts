import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PortfolioApiError } from "./client.js";

const validToken = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s]+$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const workflowTokenPath = (
  env: NodeJS.ProcessEnv,
): string | undefined =>
  env.RUNNER_TEMP
    ? join(env.RUNNER_TEMP, "portfolio-api-access-token")
    : undefined;
export async function readWorkflowAccessToken(
  path: string | undefined,
): Promise<string> {
  try {
    if (!path) throw new Error();
    const token = await readFile(path, "utf8");
    if (!validToken(token)) throw new Error();
    return token;
  } catch {
    throw new PortfolioApiError("PORTFOLIO_API_AUTH_FAILED");
  }
}
export async function workflowAuth(
  action: "issue" | "revoke",
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
  mask: (value: string) => void = () => undefined,
): Promise<void> {
  try {
    const url = new URL(env.PORTFOLIO_API_URL ?? "");
    const path = workflowTokenPath(env);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !path
    )
      throw new Error();
    const revoke = async (token: string) => {
      const response = await request(`${url.origin}/auth/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error();
    };
    if (action === "revoke") {
      let token: string;
      try {
        token = await readFile(path, "utf8");
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return;
        throw error;
      }
      try {
        if (!validToken(token)) throw new Error();
        mask(token);
        await revoke(token);
      } finally {
        await rm(path, { force: true });
      }
      return;
    }
    const oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
    if (
      oidcUrl.protocol !== "https:" ||
      oidcUrl.username ||
      oidcUrl.password ||
      !validToken(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    )
      throw new Error();
    oidcUrl.searchParams.set("audience", url.origin);
    const oidcResponse = await request(oidcUrl.toString(), {
      headers: {
        Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!oidcResponse.ok) throw new Error();
    const oidc: unknown = await oidcResponse.json();
    if (!object(oidc) || !validToken(oidc.value)) throw new Error();
    mask(oidc.value);
    const response = await request(`${url.origin}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        subject_token: oidc.value,
        scope: "project:write",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error();
    const body: unknown = await response.json();
    if (!object(body) || !validToken(body.access_token)) throw new Error();
    const issuedToken = body.access_token;
    mask(issuedToken);
    try {
      if (
        body.token_type !== "Bearer" ||
        body.scope !== "project:write" ||
        typeof body.expires_in !== "number" ||
        !Number.isFinite(body.expires_in) ||
        body.expires_in <= 0 ||
        body.expires_in > 900
      )
        throw new Error();
      await writeFile(path, issuedToken, { mode: 0o600, flag: "wx" });
    } catch {
      await revoke(issuedToken);
      throw new Error();
    }
  } catch {
    throw new PortfolioApiError("PORTFOLIO_API_AUTH_FAILED");
  }
}
const direct =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direct) {
  try {
    const action = process.argv[2];
    if (action !== "issue" && action !== "revoke") throw new Error();
    await workflowAuth(action, process.env, fetch, (value) =>
      console.log(`::add-mask::${value}`),
    );
  } catch {
    console.error("Portfolio API workflow authentication failed");
    process.exitCode = 1;
  }
}
