import { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import {
  listOrganizationRepositories,
  ORGANIZATION,
} from "./list-organization-repositories.js";

const repository = (id: number, name: string) => ({
  id,
  name,
  full_name: `${ORGANIZATION}/${name}`,
  html_url: `https://github.com/${ORGANIZATION}/${name}`,
  default_branch: "main",
  visibility: "public",
  private: false,
  archived: false,
  fork: false,
  pushed_at: "2026-11-01T00:00:00Z",
});

const createTestOctokit = (fetchMock: typeof fetch) =>
  new Octokit({
    auth: "test-token",
    request: { fetch: fetchMock },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });

describe("listOrganizationRepositories", () => {
  it("페이지가 나뉜 조직 저장소를 모두 조회한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      const body =
        page === "2"
          ? [repository(2, "project-two")]
          : [repository(1, "project-one")];

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(page === null
            ? {
                link: `<https://api.github.com/orgs/${ORGANIZATION}/repos?type=all&per_page=100&page=2>; rel="next"`,
              }
            : {}),
        },
      });
    });
    const octokit = createTestOctokit(fetchMock);

    const repositories = await listOrganizationRepositories(octokit);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      expect.stringContaining(
        `/orgs/${ORGANIZATION}/repos?type=all&per_page=100`,
      ),
      expect.stringContaining(
        `/orgs/${ORGANIZATION}/repos?type=all&per_page=100&page=2`,
      ),
    ]);
    expect(repositories).toEqual([
      {
        id: 1,
        name: "project-one",
        fullName: `${ORGANIZATION}/project-one`,
        url: `https://github.com/${ORGANIZATION}/project-one`,
        defaultBranch: "main",
        visibility: "public",
        archived: false,
        fork: false,
        pushedAt: "2026-11-01T00:00:00Z",
      },
      {
        id: 2,
        name: "project-two",
        fullName: `${ORGANIZATION}/project-two`,
        url: `https://github.com/${ORGANIZATION}/project-two`,
        defaultBranch: "main",
        visibility: "public",
        archived: false,
        fork: false,
        pushedAt: "2026-11-01T00:00:00Z",
      },
    ]);
  });

  it("저장소 ID가 중복되면 한 번만 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      const body =
        page === "2"
          ? [repository(1, "project-one"), repository(2, "project-two")]
          : [repository(1, "project-one")];

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(page === null
            ? {
                link: `<https://api.github.com/orgs/${ORGANIZATION}/repos?type=all&per_page=100&page=2>; rel="next"`,
              }
            : {}),
        },
      });
    });
    const octokit = createTestOctokit(fetchMock);

    const repositories = await listOrganizationRepositories(octokit);

    expect(repositories.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("조직 저장소가 없으면 빈 목록을 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).resolves.toEqual([]);
  });

  it("공개 범위와 보관·포크 상태를 저장소 메타데이터에 반영한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              ...repository(3, "archived-fork"),
              visibility: "internal",
              private: true,
              archived: true,
              fork: true,
              pushed_at: null,
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).resolves.toEqual([
      {
        id: 3,
        name: "archived-fork",
        fullName: `${ORGANIZATION}/archived-fork`,
        url: `https://github.com/${ORGANIZATION}/archived-fork`,
        defaultBranch: "main",
        visibility: "internal",
        archived: true,
        fork: true,
        pushedAt: null,
      },
    ]);
  });

  it("인증 실패를 토큰과 원문 응답 없이 안전한 오류로 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ message: "Bad credentials: token-secret-value" }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      message: "GitHub authentication failed",
    });
  });

  it("권한 부족을 원문 응답 없이 안전한 오류로 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ message: "private repository details" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "GitHub repository access denied",
    });
  });

  it("rate limit 응답을 안전한 오류로 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            message: "secondary rate limit: do not log this response",
          }),
          {
            status: 403,
            headers: {
              "content-type": "application/json",
              "retry-after": "60",
            },
          },
        ),
    );
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "GitHub API rate limit reached",
    });
  });

  it("재시도 헤더가 없는 보조 rate limit도 구분한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            message: "You have exceeded a secondary rate limit",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "GitHub API rate limit reached",
    });
  });

  it("429 응답을 rate limit 오류로 분류한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "GitHub API rate limit reached",
    });
  });

  it("페이지 조회가 실패하면 원문 오류 없이 안전한 오류를 반환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("page") === "2") {
        return new Response(
          JSON.stringify({ message: "private repository details" }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify([repository(1, "project-one")]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<https://api.github.com/orgs/${ORGANIZATION}/repos?type=all&per_page=100&page=2>; rel="next"`,
        },
      });
    });
    const octokit = createTestOctokit(fetchMock);

    await expect(listOrganizationRepositories(octokit)).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      message: "GitHub repository discovery failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
