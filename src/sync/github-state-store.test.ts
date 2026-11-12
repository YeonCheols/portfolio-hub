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
      if (init?.method === "PATCH")
        return json({ message: "private error" }, 422);
      if (path.includes("/git/commits/"))
        return json({ tree: { sha: "old-tree" } });
      if (path.endsWith("/trees")) return json({ sha: "new-tree" });
      if (path.endsWith("/commits")) return json({ sha: "new-commit" });
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
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method !== "GET")
        .map(([, init]) => init?.method),
    ).toEqual(["POST", "POST", "PATCH"]);
    expect(
      JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)),
    ).toMatchObject({ force: false });
  });
  it("기존 파일과 같으면 쓰지 않으며 변경되면 읽었던 커밋을 부모로 갱신한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/git/ref/"))
        return json({ object: { sha: "branch-commit" } });
      if (url.pathname.includes("/git/commits/"))
        return json({ tree: { sha: "old-tree" } });
      if (url.pathname.endsWith("/trees")) return json({ sha: "new-tree" });
      if (url.pathname.endsWith("/commits")) return json({ sha: "new-commit" });
      if (init?.method === "PATCH")
        return json({ object: { sha: "new-commit" } });
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
    const commit = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/commits") && init?.method === "POST",
    )!;
    expect(JSON.parse(String(commit[1]?.body))).toMatchObject({
      parents: ["branch-commit"],
    });
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({
      sha: "new-commit",
      force: false,
    });
  });
  it("초기 실행은 코드 없이 상태와 한국 시간 날짜별 실패 이력을 함께 저장한다", async () => {
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
    await store.save(state, [
      {
        repositoryId: 1,
        fullName: "side-projects-labs/demo",
        defaultBranch: "master",
        headSha: "b".repeat(40),
        failedAt: "2026-11-12T16:00:00.000Z",
        code: "PERMISSION_DENIED",
      },
    ]);
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
      expect.objectContaining({
        path: "state/failures/2026-11-13/failures.json",
      }),
    ]);
    expect(writes[1].body.parents).toEqual([]);
    expect(writes[2].body).toEqual({
      ref: "refs/heads/sync-state",
      sha: "commit-sha",
    });
  });
});

describe("dated failure persistence", () => {
  const failure = {
    repositoryId: 1,
    fullName: "side-projects-labs/demo",
    defaultBranch: "master",
    headSha: "b".repeat(40),
    failedAt: "2026-11-12T01:00:00.000Z",
    code: "REQUEST_FAILED",
  };
  const historyResponse = (content: string) =>
    json({
      type: "file",
      encoding: "base64",
      sha: "blob",
      content: Buffer.from(content).toString("base64"),
    });
  it("같은 날짜의 실패를 누적하고 다른 날짜는 분리하며 성공 후에도 이력을 유지한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.pathname);
      if (path.includes("/git/ref/"))
        return json({ object: { sha: "parent" } });
      if (path.endsWith("/repositories.json"))
        return historyResponse(JSON.stringify(state));
      if (path.includes("/failures/2026-11-12/"))
        return historyResponse(
          JSON.stringify({ schemaVersion: 1, failures: [failure] }),
        );
      if (path.includes("/failures/2026-11-13/"))
        return json({ message: "Not Found" }, 404);
      if (path.includes("/git/commits/"))
        return json({ tree: { sha: "base-tree" } });
      if (path.endsWith("/trees")) return json({ sha: "tree" });
      if (path.endsWith("/commits")) return json({ sha: "new-commit" });
      if (init?.method === "PATCH")
        return json({ object: { sha: "new-commit" } });
      throw new Error("Unexpected request");
    });
    const store = createGitHubStateStore(
      client(fetchMock),
      "YeonCheols/portfolio-hub",
    );
    await store.load();
    await store.save(state, [
      { ...failure, failedAt: "2026-11-12T02:00:00.000Z" },
      { ...failure, failedAt: "2026-11-12T15:00:00.000Z" },
    ]);
    const treeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/trees"),
    )!;
    const tree = JSON.parse(String(treeCall[1]?.body));
    expect(tree.base_tree).toBe("base-tree");
    expect(tree.tree.map((item: { path: string }) => item.path)).toEqual([
      "state/repositories.json",
      "state/failures/2026-11-12/failures.json",
      "state/failures/2026-11-13/failures.json",
    ]);
    expect(JSON.parse(tree.tree[1].content).failures).toHaveLength(2);
    expect(JSON.parse(tree.tree[2].content).failures).toHaveLength(1);
    const callCount = fetchMock.mock.calls.length;
    await store.save(state);
    expect(fetchMock).toHaveBeenCalledTimes(callCount);
  });
  it("기존 날짜의 실패 이력이 손상되면 상태도 갱신하지 않고 안전한 오류만 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
      if (path.includes("/git/ref/"))
        return json({ object: { sha: "parent" } });
      return historyResponse(
        path.endsWith("/repositories.json")
          ? JSON.stringify(state)
          : "broken private-source",
      );
    });
    const store = createGitHubStateStore(
      client(fetchMock),
      "YeonCheols/portfolio-hub",
    );
    await store.load();
    await expect(store.save(state, [failure])).rejects.toMatchObject({
      code: "STATE_STORAGE_FAILED",
    });
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method === "GET"),
    ).toBe(true);
  });
});

it("수집 상태가 같아도 API 반영 체크포인트를 원자적으로 저장하고 같은 상태 재저장은 생략한다", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = decodeURIComponent(new URL(String(input)).pathname);
    if (path.includes("/git/ref/")) return json({ object: { sha: "parent" } });
    if (path.endsWith("/repositories.json"))
      return json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(state)).toString("base64"),
      });
    if (path.includes("/git/commits/"))
      return json({ tree: { sha: "base-tree" } });
    if (path.endsWith("/trees")) return json({ sha: "tree" });
    if (path.endsWith("/commits")) return json({ sha: "next" });
    if (init?.method === "PATCH") return json({ object: { sha: "next" } });
    throw new Error("Unexpected request");
  });
  const store = createGitHubStateStore(
    client(fetchMock),
    "YeonCheols/portfolio-hub",
  );
  const loaded = await store.load();
  loaded.applications = {
    "1": {
      repositoryId: 1,
      slug: "fixture",
      targetHash: "b".repeat(64),
      lastSuccessfulHeadSha: "a".repeat(40),
      lastSuccessfulAt: "2026-11-12T00:00:00Z",
      payloadHash: "c".repeat(64),
      lastResult: "success",
      lastErrorCode: null,
    },
  };
  await store.save(loaded);
  const treeCall = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/trees"),
  )!;
  const tree = JSON.parse(String(treeCall[1]?.body));
  expect(tree.base_tree).toBe("base-tree");
  expect(JSON.parse(tree.tree[0].content)).toEqual(loaded);
  expect(
    fetchMock.mock.calls.some(
      ([, init]) =>
        init?.method === "PATCH" &&
        JSON.parse(String(init.body)).force === false,
    ),
  ).toBe(true);
  const before = fetchMock.mock.calls.length;
  await store.save(loaded);
  expect(fetchMock).toHaveBeenCalledTimes(before);
});
