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
  accessToken: "fixture-token",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("portfolio-api OAuth 클라이언트", () => {
  it("워크플로가 발급받은 access token으로 API를 호출하고 별도 자격 발급은 하지 않는다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ operation: "created", project: { id: 7, slug: payload.slug } }),
    );
    const client = createPortfolioApiClient({ ...options, fetch: fetchMock });
    await expect(client.upsert(payload)).resolves.toEqual({
      operation: "created",
      projectId: 7,
      slug: payload.slug,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.invalid/service/project");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer fixture-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual(payload);
  });
});

it("인증·저장·네트워크·잘못된 응답 오류는 원문과 토큰을 숨긴 고정 코드로 반환한다", async () => {
  for (const failure of ["auth", "save", "network", "response"] as const) {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (failure === "network") throw new Error("private-token-raw-error");
      if (failure === "auth")
        return json({ error: "private-token-raw-error" }, 401);
      if (failure === "save")
        return json({ error: "private-token-raw-error" }, 503);
      return json({
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
it("안전하지 않은 API 주소와 빈 토큰은 요청 전에 거부한다", () => {
  for (const baseUrl of [
    "http://api.invalid",
    "https://user:secret@api.invalid",
    "https://api.invalid/?secret=value",
  ]) {
    expect(() => createPortfolioApiClient({ ...options, baseUrl })).toThrow(
      "Portfolio API operation failed",
    );
  }
  for (const accessToken of ["", "token with spaces", "token\n"])
    expect(() => createPortfolioApiClient({ ...options, accessToken })).toThrow(
      "Portfolio API operation failed",
    );
});
