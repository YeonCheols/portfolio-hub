import { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import { runDiscoveryCli } from "./cli.js";

const withEmptyProjectFiles =
  (listFetch: typeof fetch): typeof fetch =>
  async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = path.includes("/commits/")
      ? { sha: "fixture-commit" }
      : /\/contents\/?$/.test(path)
        ? []
        : null;
    if (body !== null)
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return listFetch(input, init);
  };

describe("runDiscoveryCli", () => {
  it("비공개 조회 실패 뒤에도 나머지를 수집하고 비공개 본문은 출력하지 않는다", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname.endsWith("/repos"))
        return json(
          ["private-fail", "public-ok", "private-ok"].map((name, id) => ({
            id,
            name,
            full_name: `side-projects-labs/${name}`,
            html_url: `https://github.com/side-projects-labs/${name}`,
            default_branch: "stable",
            visibility: name.startsWith("private") ? "private" : "public",
            archived: false,
            fork: false,
            pushed_at: null,
          })),
        );
      if (url.pathname.includes("private-fail"))
        return json({ message: "credential-secret" }, 403);
      if (url.pathname.includes("/commits/")) return json({ sha: "fixed-sha" });
      if (/\/contents\/?$/.test(url.pathname))
        return json([
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            size: 10,
            sha: "blob",
          },
        ]);
      return json({
        type: "file",
        encoding: "base64",
        sha: "blob",
        content: Buffer.from(
          url.pathname.includes("private-ok")
            ? "private-readme-secret"
            : "# public",
        ).toString("base64"),
      });
    });
    const writeOutput = vi.fn();
    const writeError = vi.fn();
    const code = await runDiscoveryCli({
      token: "fake",
      createClient: () =>
        new Octokit({
          request: { fetch: fetchMock },
          log: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      writeOutput,
      writeError,
    });
    const output = writeOutput.mock.calls[0][0];
    expect(code).toBe(1);
    expect(JSON.parse(output)).toMatchObject({
      repositoryCount: 3,
      projectReadCount: 2,
      failedRepositoryCount: 1,
      restrictedRepositoryCount: 2,
    });
    expect(
      JSON.parse(output).publicRepositories[0].project.files[0].content,
    ).toBe("# public");
    expect(
      calls.some((path) => path.includes("private-ok/contents/README.md")),
    ).toBe(true);
    expect(output).not.toMatch(
      /private-fail|private-ok|private-readme-secret|credential-secret/,
    );
    expect(writeError).not.toHaveBeenCalled();
  });
  it("실제 프로젝트 파일을 기본 브랜치 기준으로 수집해 공개 결과에 포함한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      let body: unknown;
      if (url.pathname.endsWith("/repos"))
        body = [
          {
            id: 91,
            name: "portfolio-admin",
            full_name: "side-projects-labs/portfolio-admin",
            html_url: "https://github.com/side-projects-labs/portfolio-admin",
            default_branch: "master",
            visibility: "public",
            archived: false,
            fork: false,
            pushed_at: null,
          },
        ];
      else if (url.pathname.includes("/commits/")) body = { sha: "commit-123" };
      else if (/\/contents\/?$/.test(url.pathname))
        body = [
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            size: 10,
            sha: "blob-1",
          },
        ];
      else
        body = {
          type: "file",
          encoding: "base64",
          sha: "blob-1",
          content: Buffer.from("# 관리자").toString("base64"),
        };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const writeOutput = vi.fn();
    const code = await runDiscoveryCli({
      token: "fake",
      createClient: () =>
        new Octokit({
          request: { fetch: fetchMock },
          log: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      writeOutput,
      writeError: vi.fn(),
    });
    expect(code).toBe(0);
    expect(
      JSON.parse(writeOutput.mock.calls[0][0]).publicRepositories[0].project,
    ).toMatchObject({
      defaultBranch: "master",
      commitSha: "commit-123",
      files: [{ path: "README.md", content: "# 관리자" }],
    });
  });
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
      request: { fetch: withEmptyProjectFiles(fetchMock) },
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
      projectReadCount: 1,
      failedRepositoryCount: 0,
      emptyRepositoryCount: 0,
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
          project: {
            state: "ready",
            defaultBranch: "main",
            commitSha: "fixture-commit",
            entries: [],
            files: [],
            skippedFiles: [],
          },
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
      request: { fetch: withEmptyProjectFiles(fetchMock) },
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
      projectReadCount: 1,
      failedRepositoryCount: 0,
      emptyRepositoryCount: 0,
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
      request: { fetch: withEmptyProjectFiles(fetchMock) },
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
