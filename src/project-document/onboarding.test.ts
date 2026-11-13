import { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { PROJECT_GUIDANCE } from "./guidance.js";
import { ensureProjectGuidance } from "./onboarding.js";

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
const setup = (
  agents?: string,
  options: {
    open?: object[];
    closed?: object[];
    branch?: boolean;
    branchBase?: string;
    rootMode?: string;
  } = {},
) => {
  const writes: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (method !== "GET") writes.push({ method, path: url.pathname, body });
    let data: unknown = {};
    let status = 200;
    if (url.pathname.endsWith("/contents/AGENTS.md")) {
      expect(url.searchParams.get("ref")).toBe(head);
      if (agents === undefined) {
        status = 404;
        data = { message: "Not Found" };
      } else
        data = {
          type: "file",
          size: Buffer.byteLength(agents),
          encoding: "base64",
          content: Buffer.from(agents).toString("base64"),
          sha: "blob",
        };
    } else if (url.pathname.endsWith("/pulls") && method === "GET")
      data =
        url.searchParams.get("state") === "open"
          ? (options.open ?? [])
          : (options.closed ?? []);
    else if (url.pathname.includes("/git/ref/")) {
      if (options.branch) data = { object: { sha: "previous-branch" } };
      else {
        status = 404;
        data = { message: "Not Found" };
      }
    } else if (url.pathname.includes("/git/commits/") && method === "GET")
      data = url.pathname.endsWith("/previous-branch")
        ? {
            tree: { sha: "new-tree" },
            parents: [{ sha: options.branchBase ?? head }],
          }
        : { tree: { sha: "base-tree" } };
    else if (url.pathname.endsWith("/git/trees/base-tree"))
      data = {
        truncated: false,
        tree:
          agents === undefined
            ? []
            : [
                {
                  path: "AGENTS.md",
                  mode: options.rootMode ?? "100644",
                  type: "blob",
                  sha: "blob",
                },
              ],
      };
    else if (url.pathname.endsWith("/git/trees")) data = { sha: "new-tree" };
    else if (url.pathname.endsWith("/git/commits"))
      data = { sha: "new-commit" };
    else if (url.pathname.endsWith("/pulls")) data = { number: 17 };
    return new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  const client = new Octokit({
    request: { fetch: fetchMock },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { client, fetchMock, writes };
};

describe("ensureProjectGuidance", () => {
  it("지침이 없으면 기존 AGENTS.md를 보존한 온보딩 PR만 만들고 기본 브랜치를 수정하지 않는다", async () => {
    const { client, writes } = setup("# 기존 지침\n기존 작업 규칙입니다.\n");
    await expect(
      ensureProjectGuidance(client, client, repository, head),
    ).resolves.toBe("created");
    const tree = writes.find((call) => call.path.endsWith("/git/trees"))!;
    expect(tree.body).toMatchObject({
      base_tree: "base-tree",
      tree: [
        {
          path: "AGENTS.md",
          mode: "100644",
          type: "blob",
          content: expect.stringContaining(
            "# 기존 지침\n기존 작업 규칙입니다.\n",
          ),
        },
      ],
    });
    expect(JSON.stringify(tree.body)).toContain("PROJECT.md");
    expect(JSON.stringify(tree.body)).toContain("PROJECT.png");
    expect(
      writes.find((call) => call.path.endsWith("/git/commits"))?.body.parents,
    ).toEqual([head]);
    expect(
      writes.find((call) => call.path.endsWith("/git/refs"))?.body.ref,
    ).toMatch(/^refs\/heads\/portfolio-hub\//);
    expect(writes.find((call) => call.path.endsWith("/pulls"))?.body.base).toBe(
      "main",
    );
    expect(
      writes.some(
        (call) => call.method === "PATCH" || call.path.endsWith("/merge"),
      ),
    ).toBe(false);
  });
});

it("공통 지침이 이미 있으면 PR 조회나 쓰기를 수행하지 않는다", async () => {
  const { client, writes, fetchMock } = setup(
    `# 기존 지침\n${PROJECT_GUIDANCE}\n`,
  );
  await expect(
    ensureProjectGuidance(client, client, repository, head),
  ).resolves.toBe("current");
  expect(writes).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("중앙 지침이 바뀌면 이전 관리 구간만 교체하고 앞뒤의 사용자 규칙을 보존한다", async () => {
  const original =
    "# 앞 규칙\n<!-- portfolio-hub:project-guidance:start -->\nold-guidance\n<!-- portfolio-hub:project-guidance:end -->\n# 뒤 규칙\n";
  const { client, writes } = setup(original);
  await expect(
    ensureProjectGuidance(client, client, repository, head),
  ).resolves.toBe("created");
  const content = String(
    (
      writes.find((call) => call.path.endsWith("/git/trees"))!.body.tree as {
        content: string;
      }[]
    )[0].content,
  );
  expect(content).toBe(`# 앞 규칙\n${PROJECT_GUIDANCE}\n# 뒤 규칙\n`);
});

it("관리 구간 표식이 깨졌거나 중복되면 기존 문서를 수정하지 않고 안전하게 실패한다", async () => {
  for (const agents of [
    "<!-- portfolio-hub:project-guidance:start -->\nprivate-rule",
    `${PROJECT_GUIDANCE}\n${PROJECT_GUIDANCE}`,
  ]) {
    const { client, writes } = setup(agents);
    await expect(
      ensureProjectGuidance(client, client, repository, head),
    ).rejects.toMatchObject({ code: "ONBOARDING_FAILED" });
    expect(writes).toEqual([]);
  }
});

it("이전 버전의 온보딩 PR이 열려 있거나 같은 버전 PR이 닫혔으면 중복 생성하지 않는다", async () => {
  const pending = setup(undefined, {
    open: [
      {
        state: "open",
        head: {
          ref: "portfolio-hub/project-guidance-old",
          repo: { full_name: repository.fullName },
        },
        body: "<!-- portfolio-hub:project-guidance -->",
      },
    ],
  });
  await expect(
    ensureProjectGuidance(pending.client, pending.client, repository, head),
  ).resolves.toBe("pending");
  expect(pending.writes).toEqual([]);
  const closed = setup(undefined, { closed: [{ state: "closed" }] });
  await expect(
    ensureProjectGuidance(closed.client, closed.client, repository, head),
  ).resolves.toBe("closed");
  expect(closed.writes).toEqual([]);
});

it("브랜치 생성 뒤 PR 요청이 실패한 실행은 같은 기준과 트리의 브랜치를 재사용한다", async () => {
  const { client, writes } = setup(undefined, { branch: true });
  await expect(
    ensureProjectGuidance(client, client, repository, head),
  ).resolves.toBe("created");
  expect(
    writes.some(
      (call) =>
        call.path.endsWith("/git/refs") || call.path.endsWith("/git/commits"),
    ),
  ).toBe(false);
  expect(writes.filter((call) => call.path.endsWith("/pulls"))).toHaveLength(1);
});

it("소유 조직 밖 저장소·보관 저장소·포크에는 쓰지 않고 미리 있던 다른 브랜치도 덮어쓰지 않는다", async () => {
  const { client, writes } = setup(undefined, {
    branch: true,
    branchBase: "unrelated-parent",
  });
  await expect(
    ensureProjectGuidance(
      client,
      client,
      { ...repository, fullName: "another-org/fixture" },
      head,
    ),
  ).rejects.toMatchObject({ code: "ONBOARDING_FAILED" });
  for (const flags of [{ archived: true }, { fork: true }]) {
    await expect(
      ensureProjectGuidance(client, client, { ...repository, ...flags }, head),
    ).resolves.toBe("skipped");
  }
  expect(writes).toEqual([]);
  await expect(
    ensureProjectGuidance(client, client, repository, head),
  ).rejects.toMatchObject({ code: "ONBOARDING_FAILED" });
  expect(
    writes.some(
      (call) => call.path.endsWith("/git/refs") || call.path.endsWith("/pulls"),
    ),
  ).toBe(false);
});

it("AGENTS.md가 없으면 새 파일을 제안하며 심볼릭 링크·대용량·비 UTF-8 파일과 권한 오류는 덮어쓰지 않는다", async () => {
  const missing = setup();
  await expect(
    ensureProjectGuidance(missing.client, missing.client, repository, head),
  ).resolves.toBe("created");
  for (const data of [
    { type: "symlink", target: "other.md" },
    { type: "file", encoding: "base64", size: 100000, content: "" },
    {
      type: "file",
      encoding: "base64",
      size: 2,
      content: Buffer.from([0xff, 0xff]).toString("base64"),
    },
    { type: "file", submodule_git_url: "private-url" },
  ]) {
    const { client, writes } = setup();
    const reader = new Octokit({
      request: {
        fetch: async () =>
          new Response(JSON.stringify(data), {
            headers: { "content-type": "application/json" },
          }),
      },
    });
    await expect(
      ensureProjectGuidance(reader, client, repository, head),
    ).rejects.toMatchObject({
      code: "ONBOARDING_FAILED",
      message: "Repository guidance onboarding failed",
    });
    expect(writes).toEqual([]);
  }
});

it("Contents API가 심볼릭 링크 대상을 일반 파일로 반환해도 Git 트리의 링크를 덮어쓰지 않는다", async () => {
  const { client, writes } = setup("# 링크 대상의 기존 규칙", {
    rootMode: "120000",
  });
  await expect(
    ensureProjectGuidance(client, client, repository, head),
  ).rejects.toMatchObject({ code: "ONBOARDING_FAILED" });
  expect(writes).toEqual([]);
});

it("열린 PR의 다음 페이지에 온보딩 PR이 있어도 중복 생성하지 않는다", async () => {
  const { client } = setup();
  const pages: string[] = [];
  const writer = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        pages.push(url.searchParams.get("page") ?? "1");
        const second = url.searchParams.get("page") === "2";
        const data = second
          ? [
              {
                state: "open",
                head: {
                  ref: "portfolio-hub/project-guidance-prior",
                  repo: { full_name: repository.fullName },
                },
                body: "<!-- portfolio-hub:project-guidance -->",
              },
            ]
          : Array.from({ length: 100 }, () => ({
              state: "open",
              head: {
                ref: "unrelated",
                repo: { full_name: repository.fullName },
              },
              body: "",
            }));
        return new Response(JSON.stringify(data), {
          headers: {
            "content-type": "application/json",
            ...(second
              ? {}
              : {
                  link: '<https://api.github.com/repos/side-projects-labs/fixture/pulls?state=open&per_page=100&page=2>; rel="next"',
                }),
          },
        });
      },
    },
  });
  await expect(
    ensureProjectGuidance(client, writer, repository, head),
  ).resolves.toBe("pending");
  expect(pages).toEqual(["1", "2"]);
});
