import { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { applyProject } from "./application.js";
const repository = {
  id: 1,
  name: "fixture",
  fullName: "side-projects-labs/fixture",
  url: "https://github.com/side-projects-labs/fixture",
  defaultBranch: "main",
  visibility: "private" as const,
  archived: false,
  fork: false,
  pushedAt: null,
};
const head = "a".repeat(40);
const now = () => "2026-11-12T00:00:00Z";
const document =
  '```json\n{"schemaVersion":1,"slug":"fixture","title":"제목","description":"설명","stacks":["TypeScript"]}\n```\n\n원문입니다.\n';
const setup = () => {
  const read = vi.fn<typeof fetch>(async (input) => {
    expect(new URL(String(input)).searchParams.get("ref")).toBe(head);
    return new Response(
      JSON.stringify({
        type: "file",
        encoding: "base64",
        size: Buffer.byteLength(document),
        sha: "blob",
        content: Buffer.from(document).toString("base64"),
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const reader = new Octokit({
    request: { fetch: read },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const upsert = vi.fn(async () => ({
    operation: "created" as const,
    projectId: 7,
    slug: "fixture",
  }));
  return { reader, read, publisher: { targetHash: "b".repeat(64), upsert } };
};
describe("프로젝트 API 반영", () => {
  it("고정 HEAD의 규격 문서를 API에 반영한 뒤에만 메타데이터 체크포인트를 만들고 같은 SHA는 건너뛴다", async () => {
    const { reader, read, publisher } = setup();
    const first = await applyProject(
      reader,
      repository,
      head,
      undefined,
      publisher,
      now,
    );
    expect(first).toMatchObject({
      result: "success",
      state: {
        repositoryId: 1,
        slug: "fixture",
        lastSuccessfulHeadSha: head,
        lastSuccessfulAt: now(),
        lastResult: "success",
        lastErrorCode: null,
      },
    });
    expect(publisher.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ image: "", content: "원문입니다.\n" }),
    );
    expect(JSON.stringify(first.state)).not.toMatch(
      /원문|TypeScript|제목|access_token/,
    );
    expect(
      (
        await applyProject(
          reader,
          repository,
          head,
          first.state,
          publisher,
          now,
        )
      ).result,
    ).toBe("skipped");
    expect(read).toHaveBeenCalledTimes(1);
    expect(publisher.upsert).toHaveBeenCalledTimes(1);
  });
});

it("API 오류는 이전 성공 SHA·시각을 보존하고 다음 실행에서 같은 HEAD를 재시도한다", async () => {
  const { reader, publisher } = setup();
  const first = await applyProject(
    reader,
    repository,
    head,
    undefined,
    publisher,
    now,
  );
  const previous = { ...first.state!, lastSuccessfulHeadSha: "c".repeat(40) };
  publisher.upsert.mockRejectedValueOnce(new Error("private-token-error"));
  const failed = await applyProject(
    reader,
    repository,
    head,
    previous,
    publisher,
    now,
  );
  expect(failed).toMatchObject({
    result: "failure",
    state: {
      lastSuccessfulHeadSha: previous.lastSuccessfulHeadSha,
      lastSuccessfulAt: previous.lastSuccessfulAt,
      lastErrorCode: "REQUEST_FAILED",
    },
  });
  expect(JSON.stringify(failed)).not.toContain("private-token-error");
  expect(
    (await applyProject(reader, repository, head, failed.state, publisher, now))
      .result,
  ).toBe("success");
  expect(publisher.upsert).toHaveBeenCalledTimes(3);
});

it("문서가 없으면 반영 대기하며 빈 저장소·포크는 쓰지 않고 API 대상 변경 시 다시 반영한다", async () => {
  const { reader, read, publisher } = setup();
  const first = await applyProject(
    reader,
    repository,
    head,
    undefined,
    publisher,
    now,
  );
  await applyProject(
    reader,
    repository,
    head,
    first.state,
    { ...publisher, targetHash: "d".repeat(64) },
    now,
  );
  expect(publisher.upsert).toHaveBeenCalledTimes(2);
  for (const [repo, sha] of [
    [{ ...repository, fork: true }, head],
    [repository, null],
  ] as const) {
    expect(
      (await applyProject(reader, repo, sha, undefined, publisher, now)).result,
    ).toBe("skipped");
  }
  expect(read).toHaveBeenCalledTimes(2);
  const missing = new Octokit({
    request: {
      fetch: async () =>
        new Response('{"message":"private raw error"}', {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const pending = await applyProject(
    missing,
    repository,
    head,
    undefined,
    publisher,
    now,
  );
  expect(pending).toMatchObject({
    result: "pending",
    state: {
      lastSuccessfulHeadSha: null,
      lastErrorCode: "PROJECT_DOCUMENT_MISSING",
    },
  });
  expect(JSON.stringify(pending)).not.toContain("private raw error");
});
