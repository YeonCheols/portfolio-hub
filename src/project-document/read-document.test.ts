import { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { readProjectDocument } from "./read-document.js";
import type { OrganizationRepository } from "../github/list-organization-repositories.js";

const repository: OrganizationRepository = {
  id: 12,
  name: "example",
  fullName: "side-projects-labs/example",
  url: "https://github.com/side-projects-labs/example",
  defaultBranch: "stable",
  visibility: "private",
  archived: false,
  fork: false,
  pushedAt: null,
};
const head = "a".repeat(40);
const sha = "b".repeat(40);
const markdown =
  "형식 없는 소개입니다.\n\n문서 작성 방식은 프로젝트에서 정합니다.\n";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const client = (mock: typeof fetch) =>
  new Octokit({
    request: { fetch: mock },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
describe("readProjectDocument", () => {
  it("크기 초과·잘못된 UTF-8·심볼릭 링크는 본문을 전달하지 않는다", async () => {
    for (const [data, code] of [
      [
        { type: "file", encoding: "base64", sha, size: 300000, content: "" },
        "PROJECT_DOCUMENT_TOO_LARGE",
      ],
      [
        {
          type: "file",
          encoding: "base64",
          sha,
          size: 1,
          content: Buffer.from([255]).toString("base64"),
        },
        "PROJECT_DOCUMENT_UNREADABLE",
      ],
      [
        {
          type: "file",
          target: "README.md",
          encoding: "base64",
          sha,
          size: 0,
          content: "",
        },
        "PROJECT_DOCUMENT_UNREADABLE",
      ],
    ]) {
      const mock = vi.fn<typeof fetch>(async () => json(data));
      await expect(
        readProjectDocument(client(mock), repository, head),
      ).rejects.toMatchObject({ code });
    }
  });
  it("PROJECT.md가 없으면 다른 파일로 대체하지 않고 누락 코드만 반환한다", async () => {
    const mock = vi.fn<typeof fetch>(async () =>
      json({ message: "private repository detail" }, 404),
    );
    await expect(
      readProjectDocument(client(mock), repository, head),
    ).rejects.toMatchObject({ code: "PROJECT_DOCUMENT_MISSING" });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("고정 HEAD의 자유 형식 PROJECT.md를 원문과 출처 그대로 읽는다", async () => {
    const mock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(decodeURIComponent(url.pathname)).toBe(
        "/repos/side-projects-labs/example/contents/PROJECT.md",
      );
      expect(url.searchParams.get("ref")).toBe(head);
      expect(init?.method).toBe("GET");
      return json({
        type: "file",
        encoding: "base64",
        sha,
        size: Buffer.byteLength(markdown),
        content: Buffer.from(markdown).toString("base64"),
      });
    });
    expect(await readProjectDocument(client(mock), repository, head)).toEqual({
      source: {
        repositoryId: 12,
        fullName: repository.fullName,
        defaultBranch: "stable",
        headSha: head,
        documentSha: sha,
        path: "PROJECT.md",
      },
      markdown,
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
