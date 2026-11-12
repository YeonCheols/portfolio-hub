import { Octokit } from "@octokit/rest";
import { describe, it, expect, vi } from "vitest";
import { createGitHubStateStore } from "./github-state-store.js";
import { type SyncState } from "./state.js";
const state: SyncState = {
  schemaVersion: 1,
  repositories: {
    "1": {
      repositoryId: 1,
      fullName: "side-projects-labs/demo",
      defaultBranch: "master",
      lastSuccessfulHeadSha: "a".repeat(40),
      lastSuccessfulAt: "2026-11-12T00:00:00Z",
      lastResult: "success",
      lastErrorCode: null,
    },
  },
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const client = (fetchMock: typeof fetch) =>
  new Octokit({
    request: { fetch: fetchMock },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
describe("GitHub state store", () => {
  it("기존 브랜치의 상태 파일이 404여도 초기화하지 않는다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname.includes("/git/ref/")
        ? json({ object: { sha: "branch-commit" } })
        : json({ message: "Not Found" }, 404),
    );
    const store = createGitHubStateStore(
      client(fetchMock),
      "YeonCheols/portfolio-hub",
    );
    await expect(store.load()).rejects.toMatchObject({
      code: "STATE_STORAGE_FAILED",
    });
    await expect(store.save(state)).rejects.toMatchObject({
      code: "STATE_STORAGE_FAILED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("상태 파일이 없거나 손상돼도 기존 브랜치를 새 상태로 덮어쓰지 않는다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/git/ref/"))
        return json({ object: { sha: "branch-commit" } });
      return json({
        type: "file",
        encoding: "base64",
        sha: "old-blob",
        content: Buffer.from("broken JSON with credential").toString("base64"),
      });
    });
    const store = createGitHubStateStore(
      client(fetchMock),
      "YeonCheols/portfolio-hub",
    );
    await expect(store.load()).rejects.toMatchObject({
      code: "STATE_STORAGE_FAILED",
    });
    await expect(store.save(state)).rejects.toMatchObject({
      code: "STATE_STORAGE_FAILED",
    });
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method === "GET"),
    ).toBe(true);
  });
  it("동시 변경 충돌은 실패시키며 강제 갱신이나 재초기화를 하지 않는다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/git/ref/"))
        return json({ object: { sha: "branch-commit" } });
      if (init?.method === "PUT")
        return json({ message: "private error" }, 409);
      return json({
        type: "file",
        encoding: "base64",
        sha: "old-blob",
        content: Buffer.from(JSON.stringify(state)).toString("base64"),
      });
    });
    const store = createGitHubStateStore(
      client(fetchMock),
      "YeonCheols/portfolio-hub",
    );
    const loaded = await store.load();
    loaded.repositories["1"].lastSuccessfulHeadSha = "c".repeat(40);
    await expect(store.save(loaded)).rejects.toMatchObject({
      code: "STATE_STORAGE_FAILED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method !== "GET")
        .map(([, init]) => init?.method),
    ).toEqual(["PUT"]);
  });
  it("기존 파일을 읽고 동일하면 쓰지 않으며 변경되면 이전 blob SHA로 갱신한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/git/ref/"))
        return json({ object: { sha: "branch-commit" } });
      if (init?.method === "PUT") return json({ content: { sha: "new-blob" } });
      expect(url.searchParams.get("ref")).toBe("branch-commit");
      return json({
        type: "file",
        encoding: "base64",
        sha: "old-blob",
        content: Buffer.from(JSON.stringify(state)).toString("base64"),
      });
    });
    const store = createGitHubStateStore(
      client(fetchMock),
      "YeonCheols/portfolio-hub",
    );
    const loaded = await store.load();
    expect(loaded).toEqual(state);
    await store.save(loaded);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    loaded.repositories["1"].lastSuccessfulHeadSha = "b".repeat(40);
    await store.save(loaded);
    const put = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    )!;
    expect(JSON.parse(String(put[1]?.body))).toMatchObject({
      branch: "sync-state",
      sha: "old-blob",
    });
  });
  it("초기 실행은 코드 파일 없이 상태 파일만 담은 전용 브랜치를 만든다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "GET") return json({ message: "Not Found" }, 404);
      if (url.pathname.endsWith("/trees"))
        return json({ sha: "tree-sha" }, 201);
      if (url.pathname.endsWith("/commits"))
        return json({ sha: "commit-sha" }, 201);
      return json({ ref: "refs/heads/sync-state" }, 201);
    });
    const store = createGitHubStateStore(
      client(fetchMock),
      "YeonCheols/portfolio-hub",
    );
    expect(await store.load()).toEqual({ schemaVersion: 1, repositories: {} });
    await store.save(state);
    const writes = fetchMock.mock.calls
      .filter(([, init]) => init?.method !== "GET")
      .map(([url, init]) => ({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      }));
    expect(writes).toHaveLength(3);
    expect(writes[0].body.tree).toEqual([
      {
        path: "state/repositories.json",
        mode: "100644",
        type: "blob",
        content: JSON.stringify(state, null, 2) + "\n",
      },
    ]);
    expect(writes[1].body.parents).toEqual([]);
    expect(writes[2].body).toEqual({
      ref: "refs/heads/sync-state",
      sha: "commit-sha",
    });
  });
});
