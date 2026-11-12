import { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import { runDiscoveryCli } from "./cli.js";

describe("runDiscoveryCli", () => {
  it("GitHub App 토큰이 없으면 안전한 오류와 실패 코드를 반환한다", async () => {
    const createClient = vi.fn();
    const writeOutput = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runDiscoveryCli({
      token: undefined,
      createClient,
      writeOutput,
      writeError,
    });

    expect(exitCode).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledWith(
      JSON.stringify({
        error: {
          code: "MISSING_GITHUB_APP_TOKEN",
          message: "GitHub App token is required",
        },
      }),
    );
  });

  it("조직 저장소 목록과 요약만 출력하고 토큰은 출력하지 않는다", async () => {
    const token = "sample-installation-token";
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 91,
              name: "portfolio-admin",
              full_name: "side-projects-labs/portfolio-admin",
              html_url: "https://github.com/side-projects-labs/portfolio-admin",
              default_branch: "main",
              visibility: "public",
              private: false,
              archived: false,
              fork: false,
              pushed_at: "2026-11-01T00:00:00Z",
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const client = new Octokit({
      auth: token,
      request: { fetch: fetchMock },
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });
    const createClient = vi.fn(() => client);
    const writeOutput = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runDiscoveryCli({
      token,
      createClient,
      writeOutput,
      writeError,
    });

    expect(exitCode).toBe(0);
    expect(createClient).toHaveBeenCalledWith(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeOutput.mock.calls[0][0])).toEqual({
      organization: "side-projects-labs",
      repositoryCount: 1,
      publicRepositories: [
        {
          id: 91,
          name: "portfolio-admin",
          fullName: "side-projects-labs/portfolio-admin",
          url: "https://github.com/side-projects-labs/portfolio-admin",
          defaultBranch: "main",
          visibility: "public",
          archived: false,
          fork: false,
          pushedAt: "2026-11-01T00:00:00Z",
        },
      ],
      restrictedRepositoryCount: 0,
    });
    expect(writeOutput.mock.calls[0][0]).not.toContain(token);
    expect(writeError).not.toHaveBeenCalled();
  });

  it("비공개 저장소의 이름과 URL을 공개 로그에 출력하지 않는다", async () => {
    const token = "sample-installation-token";
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 92,
              name: "private-project-name",
              full_name: "side-projects-labs/private-project-name",
              html_url:
                "https://github.com/side-projects-labs/private-project-name",
              default_branch: "main",
              visibility: "private",
              private: true,
              archived: false,
              fork: false,
              pushed_at: "2026-11-01T00:00:00Z",
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const client = new Octokit({
      auth: token,
      request: { fetch: fetchMock },
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });
    const writeOutput = vi.fn();

    const exitCode = await runDiscoveryCli({
      token,
      createClient: () => client,
      writeOutput,
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(writeOutput).toHaveBeenCalledOnce();
    expect(writeOutput.mock.calls[0][0]).not.toContain("private-project-name");
    expect(writeOutput.mock.calls[0][0]).not.toContain("https://github.com/");
    expect(JSON.parse(writeOutput.mock.calls[0][0])).toEqual({
      organization: "side-projects-labs",
      repositoryCount: 1,
      publicRepositories: [],
      restrictedRepositoryCount: 1,
    });
  });

  it("GitHub API 오류의 원문이나 인증 정보를 로그에 남기지 않는다", async () => {
    const token = "sample-installation-token";
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ message: "Bad credentials: response-secret-value" }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const client = new Octokit({
      auth: token,
      request: { fetch: fetchMock },
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });
    const writeOutput = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runDiscoveryCli({
      token,
      createClient: () => client,
      writeOutput,
      writeError,
    });

    expect(exitCode).toBe(1);
    expect(writeOutput).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledOnce();
    expect(writeError.mock.calls[0][0]).toBe(
      JSON.stringify({
        error: {
          code: "AUTHENTICATION_FAILED",
          message: "GitHub authentication failed",
        },
      }),
    );
    expect(writeError.mock.calls[0][0]).not.toContain(token);
    expect(writeError.mock.calls[0][0]).not.toContain("response-secret-value");
  });
});
