import { describe, expect, it, vi } from "vitest";
import { createPortfolioApiClient } from "./client.js";

const payload = {
  slug: "fixture",
  title: "제목",
  description: "설명",
  image: "https://images.invalid/project.png",
  stacks: '["TypeScript"]',
  content: "자유 형식 본문",
  linkGithub: "https://github.com/example/fixture",
};
const options = {
  baseUrl: "https://api.invalid",
  clientId: "service:id",
  clientSecret: "secret +값",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("portfolio-api 서비스 클라이언트", () => {
  it("서버 자격으로 토큰을 발급받아 전체 콘텐츠를 PUT하고 유효한 토큰을 재사용한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/auth/token")
        ? json({
            access_token: "fixture-token",
            token_type: "Bearer",
            expires_in: 900,
            scope: "project:write",
          })
        : json({
            operation: "created",
            project: { id: 7, slug: payload.slug },
          }),
    );
    const client = createPortfolioApiClient({ ...options, fetch: fetchMock });
    expect(await client.upsert(payload)).toEqual({
      operation: "created",
      projectId: 7,
      slug: payload.slug,
    });
    await client.upsert(payload);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.invalid/auth/token");
    expect(String(init?.body)).toBe(
      "grant_type=client_credentials&scope=project%3Awrite",
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("service%3Aid:secret+%2B%EA%B0%92").toString("base64")}`,
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.invalid/service/project",
    );
    expect(fetchMock.mock.calls[1][1]?.method).toBe("PUT");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(
      payload,
    );
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization"),
    ).toBe("Bearer fixture-token");
  });
});

it("인증·저장·네트워크·잘못된 응답 오류는 원문과 토큰을 숨긴 고정 코드로 반환한다", async () => {
  for (const failure of ["auth", "save", "network", "response"] as const) {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (failure === "network") throw new Error("private-token-raw-error");
      if (String(input).endsWith("/auth/token"))
        return failure === "auth"
          ? json({ error: "private-token-raw-error" }, 401)
          : json({
              access_token: "fixture-token",
              token_type: "Bearer",
              expires_in: 900,
              scope: "project:write",
            });
      return failure === "save"
        ? json({ message: "private-token-raw-error" }, 503)
        : json({
            operation: "created",
            project: { id: 7, slug: "wrong-project" },
          });
    });
    const client = createPortfolioApiClient({ ...options, fetch: fetchMock });
    await expect(client.upsert(payload)).rejects.toMatchObject({
      code:
        failure === "auth"
          ? "PORTFOLIO_API_AUTH_FAILED"
          : failure === "response"
            ? "PORTFOLIO_API_INVALID_RESPONSE"
            : "PORTFOLIO_API_REQUEST_FAILED",
      message: "Portfolio API operation failed",
    });
  }
});

it("토큰 만료가 가까워지면 새로 발급하고 안전하지 않은 API 주소는 요청 전에 거부한다", async () => {
  let now = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith("/auth/token")
      ? json({
          access_token: "fixture-token",
          token_type: "Bearer",
          expires_in: 900,
          scope: "project:write",
        })
      : json({
          operation: "unchanged",
          project: { id: 7, slug: payload.slug },
        }),
  );
  const client = createPortfolioApiClient({
    ...options,
    fetch: fetchMock,
    now: () => now,
  });
  await client.upsert(payload);
  now = 880000;
  await client.upsert(payload);
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/token")),
  ).toHaveLength(2);
  for (const baseUrl of [
    "http://api.invalid",
    "https://user:secret@api.invalid",
    "https://api.invalid/?secret=value",
  ]) {
    expect(() =>
      createPortfolioApiClient({ ...options, baseUrl, fetch: fetchMock }),
    ).toThrow("Portfolio API operation failed");
  }
});
