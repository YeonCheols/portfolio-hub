import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function publishWorkflowConfig(
  env: NodeJS.ProcessEnv,
  mask: (value: string) => void,
): Promise<void> {
  try {
    if (!env.GITHUB_ENV) throw new Error();
    for (const flag of ["HUB_ONBOARDING_ENABLED", "HUB_PROJECT_SYNC_ENABLED"])
      if (env[flag] !== "true" && env[flag] !== "false") throw new Error();
    const keys = [
      "HUB_GITHUB_APP_CLIENT_ID",
      "HUB_GITHUB_APP_PRIVATE_KEY",
      "HUB_ONBOARDING_ENABLED",
      "HUB_PROJECT_SYNC_ENABLED",
    ];
    if (env.HUB_PROJECT_SYNC_ENABLED === "true") keys.push("PORTFOLIO_API_URL");
    const entries = keys.map((key) => {
      const value = env[key];
      if (
        !value?.trim() ||
        value.includes("__REQUIRED_") ||
        value.includes("\0")
      )
        throw new Error();
      return { key, value };
    });
    let output = "";
    for (const { key, value } of entries) {
      if (key.endsWith("_PRIVATE_KEY")) mask(value);
      let delimiter = randomUUID();
      while (value.includes(delimiter)) delimiter = randomUUID();
      output += `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
    }
    await appendFile(env.GITHUB_ENV, output, { mode: 0o600 });
  } catch {
    throw new Error("WORKFLOW_CONFIG_INVALID");
  }
}
const direct =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direct) {
  try {
    await publishWorkflowConfig(process.env, (value) =>
      console.log(
        `::add-mask::${value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`,
      ),
    );
  } catch {
    console.error("WORKFLOW_CONFIG_INVALID");
    process.exitCode = 1;
  }
}
