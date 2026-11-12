import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { workflowAuth, readWorkflowAccessToken } from "./workflow-auth.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
it("워크플로의 GitHub OIDC를 교환해 토큰을 비공개 임시 파일에 쓰고 종료 시 폐기한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-oidc-test-"));
  dirs.push(dir);
  const path = join(dir, "portfolio-api-access-token");
  const env = {
    PORTFOLIO_API_URL: "https://api.invalid",
    RUNNER_TEMP: dir,
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.invalid/token?job=1",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-runtime-token",
  };
  const request = vi.fn<typeof fetch>(async (input) =>
    String(input).startsWith("https://actions.invalid/")
      ? json({ value: "github-oidc" })
      : String(input).endsWith("/auth/token")
        ? json({
            access_token: "api-access",
            token_type: "Bearer",
            expires_in: 900,
            scope: "project:write",
          })
        : json({}),
  );
  const mask = vi.fn();
  await workflowAuth("issue", env, request, mask);
  expect(await readFile(path, "utf8")).toBe("api-access");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(request.mock.calls[0][0]).toBe(
    "https://actions.invalid/token?job=1&audience=https%3A%2F%2Fapi.invalid",
  );
  expect(
    new Headers(request.mock.calls[0][1]?.headers).get("Authorization"),
  ).toBe("Bearer github-runtime-token");
  const body = new URLSearchParams(String(request.mock.calls[1][1]?.body));
  expect(body.get("grant_type")).toBe(
    "urn:ietf:params:oauth:grant-type:token-exchange",
  );
  expect(body.get("subject_token")).toBe("github-oidc");
  expect(body.has("client_secret")).toBe(false);
  expect(mask.mock.calls.flat()).toEqual(["github-oidc", "api-access"]);
  await workflowAuth("revoke", env, request, mask);
  expect(request.mock.calls[2][0]).toBe(
    "https://api.invalid/auth/oauth/revoke",
  );
  expect(
    new URLSearchParams(String(request.mock.calls[2][1]?.body)).get("token"),
  ).toBe("api-access");
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("API 폐기 실패도 안전한 오류를 반환하고 임시 토큰은 삭제한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-oidc-test-"));
  dirs.push(dir);
  const path = join(dir, "portfolio-api-access-token");
  await writeFile(path, "api-access", { mode: 0o600 });
  await expect(readWorkflowAccessToken(path)).resolves.toBe("api-access");
  const request = vi.fn<typeof fetch>(async () => {
    throw new Error("secret-upstream-error");
  });
  await expect(
    workflowAuth(
      "revoke",
      {
        PORTFOLIO_API_URL: "https://api.invalid",
        RUNNER_TEMP: dir,
      },
      request,
    ),
  ).rejects.toMatchObject({
    code: "PORTFOLIO_API_AUTH_FAILED",
    message: "Portfolio API operation failed",
  });
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  await workflowAuth(
    "revoke",
    {
      PORTFOLIO_API_URL: "https://api.invalid",
      RUNNER_TEMP: dir,
    },
    request,
  );
  expect(request).toHaveBeenCalledTimes(1);
  await expect(readWorkflowAccessToken(path)).rejects.toMatchObject({
    code: "PORTFOLIO_API_AUTH_FAILED",
  });
});
it("토큰 파일을 저장할 수 없으면 새 access token을 즉시 폐기하고 기존 파일은 덮어쓰지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-oidc-test-"));
  dirs.push(dir);
  const path = join(dir, "portfolio-api-access-token");
  await writeFile(path, "existing-token", { mode: 0o600 });
  const request = vi.fn<typeof fetch>(async (input) =>
    String(input).startsWith("https://actions.invalid/")
      ? json({ value: "github-oidc" })
      : String(input).endsWith("/auth/token")
        ? json({
            access_token: "new-access",
            token_type: "Bearer",
            expires_in: 900,
            scope: "project:write",
          })
        : json({}),
  );
  await expect(
    workflowAuth(
      "issue",
      {
        PORTFOLIO_API_URL: "https://api.invalid",
        RUNNER_TEMP: dir,
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.invalid/token",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runtime-token",
      },
      request,
    ),
  ).rejects.toMatchObject({ code: "PORTFOLIO_API_AUTH_FAILED" });
  expect(
    new URLSearchParams(String(request.mock.calls[2][1]?.body)).get("token"),
  ).toBe("new-access");
  expect(await readFile(path, "utf8")).toBe("existing-token");
});
it("OIDC를 받을 수 없거나 API 교환이 거부되면 호출을 중단하고 오류 원문을 숨긴다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-oidc-test-"));
  dirs.push(dir);
  const env = {
    PORTFOLIO_API_URL: "https://api.invalid",
    RUNNER_TEMP: dir,
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.invalid/token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runtime-token",
  };
  for (const failure of ["oidc", "exchange", "response"] as const) {
    const request = vi.fn<typeof fetch>(async (input) =>
      String(input).startsWith("https://actions.invalid/")
        ? failure === "oidc"
          ? json({ error: "private-error" }, 401)
          : json({ value: "github-oidc" })
        : failure === "exchange"
          ? json({ error: "private-error" }, 401)
          : json({ access_token: "invalid token" }),
    );
    await expect(workflowAuth("issue", env, request)).rejects.toMatchObject({
      code: "PORTFOLIO_API_AUTH_FAILED",
      message: "Portfolio API operation failed",
    });
    await expect(
      readFile(join(dir, "portfolio-api-access-token")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
});
