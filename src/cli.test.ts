import { emptyState, type SyncState } from "./sync/state.js";
import { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import { createPortfolioApiClient } from "./portfolio-api/client.js";
import { parseState } from "./sync/state.js";
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

const memoryStore = (initial: SyncState = emptyState()) => {
  let state = structuredClone(initial);
  return {
    load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (next: SyncState) => {
      state = structuredClone(next);
    }),
  };
};

describe("runDiscoveryCli", () => {
  it("수집 파일이 생략되면 성공 SHA를 앞당기지 않는다", async () => {
    const store = memoryStore({
      schemaVersion: 1,
      repositories: {
        "1": {
          repositoryId: 1,
          fullName: "side-projects-labs/demo",
          defaultBranch: "master",
          lastSuccessfulHeadSha: "a".repeat(40),
          lastSuccessfulAt: "2026-11-11T00:00:00Z",
          lastResult: "success",
          lastErrorCode: null,
        },
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      const data = path.endsWith("/repos")
        ? [
            {
              id: 1,
              name: "demo",
              full_name: "side-projects-labs/demo",
              html_url: "https://github.com/side-projects-labs/demo",
              default_branch: "master",
              visibility: "public",
              archived: false,
              fork: false,
              pushed_at: null,
            },
          ]
        : path.includes("/commits/")
          ? { sha: "b".repeat(40) }
          : [
              {
                name: "README.md",
                path: "README.md",
                type: "file",
                size: 300_000,
                sha: "blob",
              },
            ];
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const code = await runDiscoveryCli({
      token: "fake",
      stateStore: store,
      createClient: () =>
        new Octokit({
          request: { fetch: fetchMock },
          log: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      writeOutput: vi.fn(),
      writeError: vi.fn(),
    });
    expect(code).toBe(1);
    expect(store.save.mock.calls[0]).toEqual([
      expect.anything(),
      [
        expect.objectContaining({
          repositoryId: 1,
          headSha: "b".repeat(40),
          code: "CONTENT_INCOMPLETE",
          failedAt: expect.any(String),
        }),
      ],
    ]);
    expect((await store.load()).repositories["1"]).toMatchObject({
      lastSuccessfulHeadSha: "a".repeat(40),
      lastSuccessfulAt: "2026-11-11T00:00:00Z",
      lastResult: "failure",
      lastErrorCode: "CONTENT_INCOMPLETE",
    });
  });
  it("이전 상태를 읽지 못하면 저장소 수집이나 상태 저장을 시작하지 않는다", async () => {
    const store = memoryStore();
    store.load.mockRejectedValue(new Error("private-state-error"));
    const createClient = vi.fn();
    const error = vi.fn();
    expect(
      await runDiscoveryCli({
        token: "fake",
        stateStore: store,
        createClient,
        writeOutput: vi.fn(),
        writeError: error,
      }),
    ).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(JSON.parse(error.mock.calls[0][0]).error.code).toBe(
      "STATE_STORAGE_FAILED",
    );
    expect(error.mock.calls[0][0]).not.toContain("private-state-error");
  });
  it("변경 HEAD 수집에 실패하면 이전 성공을 보존하고 재시도 성공 후에만 갱신한다", async () => {
    const previous = {
      repositoryId: 1,
      fullName: "side-projects-labs/demo",
      defaultBranch: "master",
      lastSuccessfulHeadSha: "a".repeat(40),
      lastSuccessfulAt: "2026-11-11T00:00:00Z",
      lastResult: "success" as const,
      lastErrorCode: null,
    };
    const store = memoryStore({
      schemaVersion: 1,
      repositories: { "1": previous },
    });
    let fail = true;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (path.endsWith("/repos"))
        return json([
          {
            id: 1,
            name: "demo",
            full_name: previous.fullName,
            html_url: "https://github.com/side-projects-labs/demo",
            default_branch: "master",
            visibility: "private",
            archived: false,
            fork: false,
            pushed_at: null,
          },
        ]);
      if (path.includes("/commits/")) return json({ sha: "b".repeat(40) });
      if (fail) return json({ message: "private-error" }, 403);
      return json([]);
    });
    const deps = {
      token: "fake",
      stateStore: store,
      now: () => "2026-11-12T00:00:00Z",
      createClient: () =>
        new Octokit({
          request: { fetch: fetchMock },
          log: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      writeOutput: vi.fn(),
      writeError: vi.fn(),
    };
    expect(await runDiscoveryCli(deps)).toBe(1);
    expect((await store.load()).repositories["1"]).toMatchObject({
      lastSuccessfulHeadSha: previous.lastSuccessfulHeadSha,
      lastSuccessfulAt: previous.lastSuccessfulAt,
      lastResult: "failure",
      lastErrorCode: "PERMISSION_DENIED",
    });
    fail = false;
    expect(await runDiscoveryCli(deps)).toBe(0);
    expect((await store.load()).repositories["1"]).toMatchObject({
      lastSuccessfulHeadSha: "b".repeat(40),
      lastSuccessfulAt: "2026-11-12T00:00:00Z",
      lastResult: "success",
      lastErrorCode: null,
    });
    const before = fetchMock.mock.calls.length;
    expect(await runDiscoveryCli(deps)).toBe(0);
    expect(fetchMock.mock.calls.length - before).toBe(2);
    expect(JSON.stringify(await store.load())).not.toMatch(
      /content|token|private-error/,
    );
  });
  it("상태 저장 실패는 성공 결과를 출력하지 않고 안전한 저장 오류로 반환한다", async () => {
    const store = memoryStore();
    store.save.mockRejectedValue(new Error("state-token-secret"));
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const output = vi.fn();
    const error = vi.fn();
    const code = await runDiscoveryCli({
      token: "fake",
      stateStore: store,
      createClient: () =>
        new Octokit({
          request: { fetch: fetchMock },
          log: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      writeOutput: output,
      writeError: error,
    });
    expect(code).toBe(1);
    expect(output).not.toHaveBeenCalled();
    expect(JSON.parse(error.mock.calls[0][0]).error.code).toBe(
      "STATE_STORAGE_FAILED",
    );
    expect(error.mock.calls[0][0]).not.toContain("state-token-secret");
  });
  it("성공 SHA가 같으면 파일 본문을 읽지 않고 상태를 변경하지 않는다", async () => {
    const record = {
      repositoryId: 1,
      fullName: "side-projects-labs/demo",
      defaultBranch: "master",
      lastSuccessfulHeadSha: "a".repeat(40),
      lastSuccessfulAt: "2026-11-11T00:00:00Z",
      lastResult: "success" as const,
      lastErrorCode: null,
    };
    const store = memoryStore({
      schemaVersion: 1,
      repositories: { "1": record },
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      const data = path.endsWith("/repos")
        ? [
            {
              id: 1,
              name: "demo",
              full_name: record.fullName,
              html_url: "https://github.com/side-projects-labs/demo",
              default_branch: "master",
              visibility: "public",
              archived: false,
              fork: false,
              pushed_at: null,
            },
          ]
        : { sha: "a".repeat(40) };
      if (path.includes("/contents"))
        throw new Error("Must not request contents");
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const output = vi.fn();
    const code = await runDiscoveryCli({
      token: "fake",
      stateStore: store,
      createClient: () =>
        new Octokit({
          request: { fetch: fetchMock },
          log: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      writeOutput: output,
      writeError: vi.fn(),
    });
    expect(code).toBe(0);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      skippedRepositoryCount: 1,
      projectReadCount: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenCalledWith({
      schemaVersion: 1,
      repositories: { "1": record },
    });
  });
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
      stateStore: memoryStore(),
      now: () => "2026-11-12T00:00:00Z",
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
      stateStore: memoryStore(),
      now: () => "2026-11-12T00:00:00Z",
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
      stateStore: memoryStore(),
      now: () => "2026-11-12T00:00:00Z",
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
      stateStore: memoryStore(),
      now: () => "2026-11-12T00:00:00Z",
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
      skippedRepositoryCount: 0,
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
      stateStore: memoryStore(),
      now: () => "2026-11-12T00:00:00Z",
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
      skippedRepositoryCount: 0,
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
      stateStore: memoryStore(),
      now: () => "2026-11-12T00:00:00Z",
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

it("동일 SHA라도 지침을 확인하고 온보딩 실패는 수집 체크포인트와 분리하며 비공개 정보는 출력하지 않는다", async () => {
  const records = ["public-fixture", "private-fixture"].map((name, index) => ({
    repositoryId: index + 1,
    fullName: `side-projects-labs/${name}`,
    defaultBranch: "main",
    lastSuccessfulHeadSha: "a".repeat(40),
    lastSuccessfulAt: "2026-11-11T00:00:00Z",
    lastResult: "success" as const,
    lastErrorCode: null,
  }));
  const store = memoryStore({
    schemaVersion: 1,
    repositories: Object.fromEntries(
      records.map((record) => [String(record.repositoryId), record]),
    ),
  });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  const read = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/repos"))
      return json(
        records.map((record, index) => ({
          id: record.repositoryId,
          name: record.fullName.split("/")[1],
          full_name: record.fullName,
          html_url: `https://github.com/${record.fullName}`,
          default_branch: "main",
          visibility: index === 0 ? "public" : "private",
          archived: false,
          fork: false,
          pushed_at: null,
        })),
      );
    if (url.pathname.includes("/commits/"))
      return json({ sha: "a".repeat(40), tree: { sha: "base-tree" } });
    if (url.pathname.endsWith("/AGENTS.md"))
      return json({ message: "Not Found" }, 404);
    if (url.pathname.endsWith("/git/trees/base-tree"))
      return json({ truncated: false, tree: [] });
    throw new Error("수집 본문은 읽지 않습니다");
  });
  const writes: string[] = [];
  const write = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("private-fixture"))
      return json({ message: "private-fixture-token-error" }, 403);
    if (init?.method === "POST") writes.push(path);
    if (path.includes("/git/ref/")) return json({ message: "Not Found" }, 404);
    if (path.endsWith("/pulls") && init?.method !== "POST") return json([]);
    return json({ sha: "result-sha", number: 1 });
  });
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const output = vi.fn();
  const errors = vi.fn();
  const deps = {
    token: "read-token",
    stateStore: store,
    createClient: () => new Octokit({ request: { fetch: read }, log }),
    onboardingClient: new Octokit({ request: { fetch: write }, log }),
    writeOutput: output,
    writeError: errors,
  };
  expect(await runDiscoveryCli(deps)).toBe(1);
  expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
    skippedRepositoryCount: 2,
    failedRepositoryCount: 0,
    onboarding: { created: 1, failed: 1 },
  });
  expect((await store.load()).repositories).toEqual(
    Object.fromEntries(
      records.map((record) => [String(record.repositoryId), record]),
    ),
  );
  expect(writes.filter((path) => path.endsWith("/pulls"))).toHaveLength(1);
  expect(JSON.stringify([output.mock.calls, errors.mock.calls])).not.toMatch(
    /private-fixture|token-error|read-token/,
  );
});

it("온보딩을 활성화했는데 쓰기용 인증이 없으면 조회나 수집을 시작하지 않는다", async () => {
  const createClient = vi.fn();
  const errors = vi.fn();
  const deps = {
    token: "read-token",
    requireOnboarding: true,
    stateStore: memoryStore(),
    createClient,
    writeOutput: vi.fn(),
    writeError: errors,
  };
  expect(await runDiscoveryCli(deps)).toBe(1);
  expect(createClient).not.toHaveBeenCalled();
  expect(JSON.parse(errors.mock.calls[0][0]).error.code).toBe(
    "MISSING_ONBOARDING_TOKEN",
  );
});

it("빈 저장소는 온보딩 쓰기를 건너뛰고 기존 빈 저장소 재확인 정책을 유지한다", async () => {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/repos"))
      return json([
        {
          id: 1,
          name: "empty",
          full_name: "side-projects-labs/empty",
          html_url: "https://github.com/side-projects-labs/empty",
          default_branch: "main",
          visibility: "private",
          archived: false,
          fork: false,
          pushed_at: null,
        },
      ]);
    if (path.includes("/commits/"))
      return json({ message: "Git Repository is empty" }, 409);
    throw new Error("빈 저장소 파일을 읽으면 안 됩니다");
  });
  const write = vi.fn<typeof fetch>(async () =>
    json({ message: "unexpected-write" }, 403),
  );
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const output = vi.fn();
  expect(
    await runDiscoveryCli({
      token: "fake",
      stateStore: memoryStore(),
      createClient: () => new Octokit({ request: { fetch: fetchMock }, log }),
      onboardingClient: new Octokit({ request: { fetch: write }, log }),
      writeOutput: output,
      writeError: vi.fn(),
    }),
  ).toBe(0);
  expect(write).not.toHaveBeenCalled();
  expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
    emptyRepositoryCount: 1,
    onboarding: { skipped: 1, failed: 0 },
  });
});

it("수집 SHA가 같아도 미반영 문서를 API에 전송하고 실패는 다음 실행에 재시도하며 공개 로그에 본문을 남기지 않는다", async () => {
  const head = "a".repeat(40);
  const records = ["private-publish", "public-publish"].map((name, index) => ({
    repositoryId: index + 1,
    fullName: `side-projects-labs/${name}`,
    defaultBranch: "main",
    lastSuccessfulHeadSha: head,
    lastSuccessfulAt: "2026-11-11T00:00:00Z",
    lastResult: "success" as const,
    lastErrorCode: null,
  }));
  const store = memoryStore({
    schemaVersion: 1,
    repositories: Object.fromEntries(
      records.map((r) => [String(r.repositoryId), r]),
    ),
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/repos"))
      return json(
        records.map((r, index) => ({
          id: r.repositoryId,
          name: r.fullName.split("/")[1],
          full_name: r.fullName,
          html_url: `https://github.com/${r.fullName}`,
          default_branch: "main",
          visibility: index === 0 ? "private" : "public",
          archived: false,
          fork: false,
          pushed_at: null,
        })),
      );
    if (url.pathname.includes("/commits/")) return json({ sha: head });
    expect(url.pathname.endsWith("/PROJECT.md")).toBe(true);
    expect(url.searchParams.get("ref")).toBe(head);
    const doc =
      '```json\n{"schemaVersion":1,"slug":"fixture","title":"제목","description":"설명","stacks":[]}\n```\n\n문서 원문 비밀값이 아닌 공개용 소개';
    return json({
      type: "file",
      encoding: "base64",
      size: Buffer.byteLength(doc),
      sha: "blob",
      content: Buffer.from(
        doc.replace(
          '"slug":"fixture"',
          `"slug":"${url.pathname.includes("private-publish") ? "private-fixture" : "public-fixture"}"`,
        ),
      ).toString("base64"),
    });
  });
  const upsert = vi.fn(async (payload: { slug: string }) => ({
    operation: "unchanged" as const,
    projectId: 7,
    slug: payload.slug,
  }));
  upsert.mockRejectedValueOnce(new Error("secret-api-error"));
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const output = vi.fn();
  const deps = {
    token: "fake",
    stateStore: store,
    projectPublisher: { targetHash: "b".repeat(64), upsert },
    createClient: () => new Octokit({ request: { fetch: fetchMock }, log }),
    writeOutput: output,
    writeError: vi.fn(),
  };
  expect(await runDiscoveryCli(deps)).toBe(1);
  expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
    failedRepositoryCount: 0,
    projectSync: { success: 1, failure: 1 },
  });
  expect(await runDiscoveryCli(deps)).toBe(0);
  expect(upsert).toHaveBeenCalledTimes(3);
  const state = await store.load();
  expect(state.applications?.["1"].lastSuccessfulHeadSha).toBe(head);
  expect(state.applications?.["2"].lastSuccessfulHeadSha).toBe(head);
  expect(JSON.stringify([state, output.mock.calls])).not.toMatch(
    /문서 원문|secret-api-error|access_token/,
  );
  expect(JSON.stringify(output.mock.calls)).not.toContain("private-publish");
});

it("서로 다른 저장소가 같은 slug를 제공하면 두 번째 저장소가 첫 프로젝트를 덮어쓰지 않는다", async () => {
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  const document =
    '```json\n{"schemaVersion":1,"slug":"duplicate","title":"제목","description":"설명","stacks":[]}\n```\n\n본문';
  const read = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/repos"))
      return json(
        [1, 2].map((id) => ({
          id,
          name: `fixture-${id}`,
          full_name: `side-projects-labs/fixture-${id}`,
          html_url: `https://github.com/side-projects-labs/fixture-${id}`,
          default_branch: "main",
          visibility: "private",
          archived: false,
          fork: false,
          pushed_at: null,
        })),
      );
    if (path.includes("/commits/")) return json({ sha: "a".repeat(40) });
    if (path.endsWith("/PROJECT.md"))
      return json({
        type: "file",
        encoding: "base64",
        size: Buffer.byteLength(document),
        sha: "blob",
        content: Buffer.from(document).toString("base64"),
      });
    return json([]);
  });
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const upsert = vi.fn(async () => ({
    operation: "created" as const,
    projectId: 1,
    slug: "duplicate",
  }));
  const store = memoryStore();
  expect(
    await runDiscoveryCli({
      token: "fake",
      stateStore: store,
      projectPublisher: { targetHash: "b".repeat(64), upsert },
      createClient: () => new Octokit({ request: { fetch: read }, log }),
      writeOutput: vi.fn(),
      writeError: vi.fn(),
    }),
  ).toBe(1);
  expect(upsert).toHaveBeenCalledTimes(1);
  expect((await store.load()).applications?.["2"].lastErrorCode).toBe(
    "PORTFOLIO_API_INVALID_INPUT",
  );
});

it("실제 API 클라이언트와 CLI를 연결해 이미지 없는 문서를 전송하고 상태 저장 실패 뒤에도 재반영한다", async () => {
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  const doc =
    '```json\n{"schemaVersion":1,"slug":"integration","title":"제목","description":"설명","stacks":["TypeScript"]}\n```\n\n프로젝트 원문';
  const apiFetch = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).endsWith("/auth/token"))
      return json({
        access_token: "fixture-access-token",
        token_type: "Bearer",
        expires_in: 900,
        scope: "project:write",
      });
    expect(String(input)).toBe("https://api.invalid/service/project");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer fixture-access-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      slug: "integration",
      title: "제목",
      description: "설명",
      stacks: '["TypeScript"]',
      content: "프로젝트 원문",
      linkDemo: null,
      linkGithub: null,
    });
    return json({
      operation: "unchanged",
      project: { id: 7, slug: "integration" },
    });
  });
  const read = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/repos"))
      return json([
        {
          id: 1,
          name: "private-integration",
          full_name: "side-projects-labs/private-integration",
          html_url: "https://github.com/side-projects-labs/private-integration",
          default_branch: "main",
          visibility: "private",
          archived: false,
          fork: false,
          pushed_at: null,
        },
      ]);
    if (path.includes("/commits/")) return json({ sha: "a".repeat(40) });
    if (path.endsWith("/PROJECT.md"))
      return json({
        type: "file",
        encoding: "base64",
        sha: "blob",
        size: Buffer.byteLength(doc),
        content: Buffer.from(doc).toString("base64"),
      });
    return json([]);
  });
  const store = memoryStore();
  store.save.mockRejectedValueOnce(new Error("private-storage-error"));
  const output = vi.fn();
  const errors = vi.fn();
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const deps = {
    token: "read-token",
    stateStore: store,
    projectPublisher: createPortfolioApiClient({
      baseUrl: "https://api.invalid",
      accessToken: "fixture-access-token",
      fetch: apiFetch,
    }),
    createClient: () => new Octokit({ request: { fetch: read }, log }),
    writeOutput: output,
    writeError: errors,
  };
  expect(await runDiscoveryCli(deps)).toBe(1);
  expect(output).not.toHaveBeenCalled();
  expect(await runDiscoveryCli(deps)).toBe(0);
  expect(
    apiFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/service/project"),
    ),
  ).toHaveLength(2);
  expect(
    parseState(JSON.stringify(await store.load())).applications?.["1"],
  ).toMatchObject({
    slug: "integration",
    lastSuccessfulHeadSha: "a".repeat(40),
    lastResult: "success",
  });
  expect(JSON.stringify([output.mock.calls, errors.mock.calls])).not.toMatch(
    /프로젝트 원문|private-integration|fixture-access-token|fixture-secret|private-storage-error/,
  );
});
