import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { publishWorkflowConfig } from "./workflow-config.js";

it("중앙 설정의 키만 Actions에 전달하고 여러 줄 비밀값을 마스킹하며 bootstrap 자격은 제외한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-config-test-"));
  try {
    const path = join(dir, "github-env");
    const key =
      "-----BEGIN PRIVATE KEY-----\nfake=line\n-----END PRIVATE KEY-----";
    const mask = vi.fn();
    await publishWorkflowConfig(
      {
        GITHUB_ENV: path,
        GH_TOKEN: "bootstrap-token",
        HUB_GITHUB_APP_CLIENT_ID: "fake-client",
        HUB_GITHUB_APP_PRIVATE_KEY: key,
        HUB_ONBOARDING_ENABLED: "false",
        HUB_PROJECT_SYNC_ENABLED: "true",
        PORTFOLIO_API_URL: "https://api.invalid",
      },
      mask,
    );
    const output = await readFile(path, "utf8");
    expect(output).toContain("HUB_GITHUB_APP_PRIVATE_KEY<<");
    expect(output).toContain(key);
    expect(output).toContain("PORTFOLIO_API_URL<<");
    expect(output).not.toContain("GH_TOKEN");
    expect(output).not.toContain("bootstrap-token");
    expect(mask).toHaveBeenCalledWith(key);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("온보딩은 같은 App 자격을 재사용하고 별도의 쓰기 App 키를 요구하지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-config-test-"));
  try {
    const path = join(dir, "github-env");
    await publishWorkflowConfig(
      {
        GITHUB_ENV: path,
        HUB_GITHUB_APP_CLIENT_ID: "fake-client",
        HUB_GITHUB_APP_PRIVATE_KEY: "fake-private-key",
        HUB_ONBOARDING_ENABLED: "true",
        HUB_PROJECT_SYNC_ENABLED: "false",
      },
      vi.fn(),
    );
    const output = await readFile(path, "utf8");
    expect(output).toContain("HUB_ONBOARDING_ENABLED<<");
    expect(output).not.toContain("HUB_ONBOARDING_APP");
    expect(output).not.toContain("PORTFOLIO_API_URL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("미입력·잘못된 활성화 값은 환경 파일에 아무 값도 기록하기 전에 거부한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-config-test-"));
  try {
    const path = join(dir, "github-env");
    const base = {
      GITHUB_ENV: path,
      HUB_GITHUB_APP_CLIENT_ID: "fake-client",
      HUB_GITHUB_APP_PRIVATE_KEY: "fake-private-key",
      HUB_ONBOARDING_ENABLED: "false",
      HUB_PROJECT_SYNC_ENABLED: "false",
    };
    for (const invalid of [
      { ...base, HUB_ONBOARDING_ENABLED: "yes" },
      { ...base, HUB_GITHUB_APP_PRIVATE_KEY: "__REQUIRED_KEY__" },
      { ...base, HUB_PROJECT_SYNC_ENABLED: "true" },
    ]) {
      const mask = vi.fn();
      await expect(publishWorkflowConfig(invalid, mask)).rejects.toThrow(
        "WORKFLOW_CONFIG_INVALID",
      );
      expect(mask).not.toHaveBeenCalled();
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
