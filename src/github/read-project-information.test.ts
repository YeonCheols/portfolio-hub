import { describe, expect, it, vi } from "vitest";
import { Octokit } from "@octokit/rest";
import { readProjectInformation } from "./read-project-information.js";
import type { OrganizationRepository } from "./list-organization-repositories.js";

const repository: OrganizationRepository = {
  id: 1,
  name: "demo",
  fullName: "side-projects-labs/demo",
  url: "https://github.com/side-projects-labs/demo",
  defaultBranch: "release/stable",
  visibility: "private",
  archived: false,
  fork: false,
  pushedAt: null,
};
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const file = (name: string, size = 100) => ({
  name,
  path: name,
  type: "file",
  size,
  sha: `blob-${name}`,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("readProjectInformation", () => {
  it("파일 조회 실패는 원문 없이 안전한 오류로 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/commits/")) return json({ sha: "commit-123" });
      if (/\/contents\/?$/.test(path)) return json([file("README.md")]);
      return json({ message: "private-source-and-token" }, 403);
    });
    await expect(
      readProjectInformation(
        new Octokit({ request: { fetch: fetchMock }, log: silent }),
        repository,
      ),
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "GitHub repository access denied",
    });
  });
  it("파일 크기 응답이 작더라도 실제 본문이 한도를 넘으면 생략한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/commits/")) return json({ sha: "commit-123" });
      if (/\/contents\/?$/.test(path)) return json([file("README.md", 1)]);
      return json({
        type: "file",
        encoding: "base64",
        sha: "blob",
        content: Buffer.from("a".repeat(300_000)).toString("base64"),
      });
    });
    const result = await readProjectInformation(
      new Octokit({ request: { fetch: fetchMock }, log: silent }),
      repository,
    );
    expect(result.files).toEqual([]);
    expect(result.skippedFiles).toEqual(["README.md"]);
  });
  it("커밋이 없는 빈 저장소는 empty 상태로 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ message: "Git Repository is empty." }, 409),
    );
    const result = await readProjectInformation(
      new Octokit({ request: { fetch: fetchMock }, log: silent }),
      repository,
    );
    expect(result).toMatchObject({
      state: "empty",
      commitSha: null,
      files: [],
      entries: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("큰 파일은 본문을 요청하지 않고 생략 사실을 남긴다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/commits/"))
        return json({ sha: "commit-123" });
      if (/\/contents\/?$/.test(url.pathname))
        return json([file("README.md", 300_000)]);
      return json({
        type: "file",
        encoding: "base64",
        sha: "blob",
        content: "",
      });
    });
    const result = await readProjectInformation(
      new Octokit({ request: { fetch: fetchMock }, log: silent }),
      repository,
    );
    expect(result.files).toEqual([]);
    expect(result.skippedFiles).toEqual(["README.md"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("언어별 프로젝트 설정을 읽고 환경변수·잠금파일은 읽지 않는다", async () => {
    const names = [
      "go.mod",
      "pyproject.toml",
      "Cargo.toml",
      "pom.xml",
      "build.gradle.kts",
      "composer.json",
      "Gemfile",
      "server.csproj",
      "pnpm-workspace.yaml",
    ];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/commits/"))
        return json({ sha: "commit-123" });
      if (/\/contents\/?$/.test(url.pathname))
        return json([
          ...names.map((name) => file(name)),
          file(".env.local"),
          file("pnpm-lock.yaml"),
        ]);
      return json({
        type: "file",
        encoding: "base64",
        sha: "blob",
        content: Buffer.from("project configuration").toString("base64"),
      });
    });
    const result = await readProjectInformation(
      new Octokit({ request: { fetch: fetchMock }, log: silent }),
      repository,
    );
    expect(result.files.map((f) => f.path)).toEqual(names);
    expect(fetchMock).toHaveBeenCalledTimes(names.length + 2);
  });
  it("기본 브랜치 HEAD의 동일 커밋에서 README와 패키지 설정을 읽는다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/commits/"))
        return json({ sha: "commit-123" });
      if (/\/contents\/?$/.test(url.pathname))
        return json([
          file("README.md"),
          file("package.json"),
          file(".env"),
          { path: "src", type: "dir" },
        ]);
      const name = url.pathname.split("/").at(-1)!;
      return json({
        type: "file",
        encoding: "base64",
        sha: `blob-${name}`,
        content: Buffer.from(
          name === "README.md"
            ? "# 실제 프로젝트"
            : '{"name":"demo","dependencies":{"react":"19"}}',
        ).toString("base64"),
      });
    });
    const result = await readProjectInformation(
      new Octokit({ request: { fetch: fetchMock }, log: silent }),
      repository,
    );
    expect(result.commitSha).toBe("commit-123");
    expect(result.defaultBranch).toBe("release/stable");
    expect(result.files.map((f) => [f.path, f.content])).toEqual([
      ["README.md", "# 실제 프로젝트"],
      ["package.json", '{"name":"demo","dependencies":{"react":"19"}}'],
    ]);
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(decodeURIComponent(urls[0].pathname)).toBe(
      "/repos/side-projects-labs/demo/commits/release/stable",
    );
    expect(
      urls
        .slice(1)
        .every((url) => url.searchParams.get("ref") === "commit-123"),
    ).toBe(true);
    expect(urls.some((url) => url.pathname.endsWith("/.env"))).toBe(false);
  });
});
