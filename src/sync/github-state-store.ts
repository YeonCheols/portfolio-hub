import type { Octokit } from "@octokit/rest";
import {
  emptyState,
  parseState,
  parseFailureHistory,
  failurePath,
  StateStorageError,
  type StateStore,
} from "./state.js";
export const STATE_BRANCH = "sync-state";
export const STATE_PATH = "state/repositories.json";
const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;
const serialize = (value: unknown): string =>
  JSON.stringify(value, null, 2) + "\n";
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
  let commitSha: string | null = null;
  let baseline = "";
  const readFile = async (path: string, ref: string): Promise<string> => {
    const response = await client.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { ...base, path, ref },
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
    return Buffer.from(data.content, "base64").toString("utf8");
  };
  return {
    load: async () => {
      loaded = false;
      try {
        const branch = await client
          .request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
            ...base,
            ref: `heads/${STATE_BRANCH}`,
          })
          .catch((error: unknown) => {
            if (isNotFound(error)) return null;
            throw error;
          });
        commitSha = branch?.data.object.sha ?? null;
        const state = commitSha
          ? parseState(await readFile(STATE_PATH, commitSha))
          : emptyState();
        baseline = serialize(state);
        loaded = true;
        return state;
      } catch {
        throw new StateStorageError();
      }
    },
    save: async (state, failures = []) => {
      if (!loaded) throw new StateStorageError();
      try {
        const content = serialize(parseState(JSON.stringify(state)));
        const validFailures = parseFailureHistory(
          JSON.stringify({ schemaVersion: 1, failures }),
        );
        if (commitSha && content === baseline && validFailures.length === 0)
          return;
        const treeEntries: {
          path: string;
          mode: "100644";
          type: "blob";
          content: string;
        }[] = [{ path: STATE_PATH, mode: "100644", type: "blob", content }];
        for (const path of new Set(
          validFailures.map((failure) => failurePath(failure.failedAt)),
        )) {
          const existing = commitSha
            ? await readFile(path, commitSha).catch((error: unknown) => {
                if (isNotFound(error)) return null;
                throw error;
              })
            : null;
          const history =
            existing === null ? [] : parseFailureHistory(existing);
          if (history.some((failure) => failurePath(failure.failedAt) !== path))
            throw new StateStorageError();
          history.push(
            ...validFailures.filter(
              (failure) => failurePath(failure.failedAt) === path,
            ),
          );
          treeEntries.push({
            path,
            mode: "100644",
            type: "blob",
            content: serialize({ schemaVersion: 1, failures: history }),
          });
        }
        const parent = commitSha
          ? await client.request(
              "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
              { ...base, commit_sha: commitSha },
            )
          : null;
        const tree = await client.request(
          "POST /repos/{owner}/{repo}/git/trees",
          {
            ...base,
            ...(parent ? { base_tree: parent.data.tree.sha } : {}),
            tree: treeEntries,
          },
        );
        const commit = await client.request(
          "POST /repos/{owner}/{repo}/git/commits",
          {
            ...base,
            message: "chore(state): update checkpoints and failure history",
            tree: tree.data.sha,
            parents: commitSha ? [commitSha] : [],
          },
        );
        if (commitSha) {
          await client.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
            ...base,
            ref: `heads/${STATE_BRANCH}`,
            sha: commit.data.sha,
            force: false,
          });
        } else {
          await client.request("POST /repos/{owner}/{repo}/git/refs", {
            ...base,
            ref: `refs/heads/${STATE_BRANCH}`,
            sha: commit.data.sha,
          });
        }
        commitSha = commit.data.sha;
        baseline = content;
      } catch {
        loaded = false;
        throw new StateStorageError();
      }
    },
  };
};
