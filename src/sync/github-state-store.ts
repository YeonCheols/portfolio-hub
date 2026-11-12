import type { Octokit } from "@octokit/rest";
import {
  emptyState,
  parseState,
  StateStorageError,
  type StateStore,
} from "./state.js";
export const STATE_BRANCH = "sync-state";
export const STATE_PATH = "state/repositories.json";
export const createGitHubStateStore = (
  client: Pick<Octokit, "request">,
  repository: string,
): StateStore => {
  const parts = repository.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => !part || !/^[A-Za-z0-9_.-]+$/.test(part))
  )
    throw new StateStorageError();
  const base = { owner: parts[0], repo: parts[1] };
  let loaded = false;
  let blobSha: string | null = null;
  let baseline = "";
  return {
    load: async () => {
      try {
        const branch = await client
          .request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
            ...base,
            ref: `heads/${STATE_BRANCH}`,
          })
          .catch((error: unknown) => {
            if (
              error &&
              typeof error === "object" &&
              "status" in error &&
              error.status === 404
            )
              return null;
            throw error;
          });
        let state = emptyState();
        blobSha = null;
        if (branch) {
          const response = await client.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            { ...base, path: STATE_PATH, ref: branch.data.object.sha },
          );
          const data = response.data;
          if (
            Array.isArray(data) ||
            data.type !== "file" ||
            !("encoding" in data) ||
            data.encoding !== "base64" ||
            typeof data.content !== "string"
          )
            throw new StateStorageError();
          state = parseState(
            Buffer.from(data.content, "base64").toString("utf8"),
          );
          blobSha = data.sha;
        }
        baseline = JSON.stringify(state, null, 2) + "\n";
        loaded = true;
        return state;
      } catch {
        loaded = false;
        throw new StateStorageError();
      }
    },
    save: async (state) => {
      if (!loaded) throw new StateStorageError();
      try {
        const content =
          JSON.stringify(parseState(JSON.stringify(state)), null, 2) + "\n";
        if (blobSha) {
          if (content === baseline) return;
          const response = await client.request(
            "PUT /repos/{owner}/{repo}/contents/{path}",
            {
              ...base,
              path: STATE_PATH,
              branch: STATE_BRANCH,
              sha: blobSha,
              message: "chore(state): update repository sync checkpoints",
              content: Buffer.from(content).toString("base64"),
            },
          );
          if (!response.data.content?.sha) throw new StateStorageError();
          blobSha = response.data.content.sha;
          baseline = content;
          return;
        }
        const tree = await client.request(
          "POST /repos/{owner}/{repo}/git/trees",
          {
            ...base,
            tree: [{ path: STATE_PATH, mode: "100644", type: "blob", content }],
          },
        );
        const commit = await client.request(
          "POST /repos/{owner}/{repo}/git/commits",
          {
            ...base,
            message: "chore(state): update repository sync checkpoints",
            tree: tree.data.sha,
            parents: [],
          },
        );
        await client.request("POST /repos/{owner}/{repo}/git/refs", {
          ...base,
          ref: `refs/heads/${STATE_BRANCH}`,
          sha: commit.data.sha,
        });
        loaded = false;
      } catch {
        throw new StateStorageError();
      }
    },
  };
};
