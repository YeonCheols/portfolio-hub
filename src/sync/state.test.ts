import { describe, expect, it } from "vitest";
import { shouldSkip, parseState, type RepositoryState } from "./state.js";

const record: RepositoryState = {
  repositoryId: 1,
  fullName: "side-projects-labs/demo",
  defaultBranch: "master",
  lastSuccessfulHeadSha: "sha-a",
  lastSuccessfulAt: "2026-11-12T00:00:00Z",
  lastResult: "success",
  lastErrorCode: null,
};
describe("sync state", () => {
  it("손상된 상태나 본문·인증정보가 섞인 상태를 빈 상태로 대체하지 않는다", () => {
    const persisted = { ...record, lastSuccessfulHeadSha: "a".repeat(40) };
    const state = { schemaVersion: 1, repositories: { "1": persisted } };
    expect(parseState(JSON.stringify(state))).toEqual(state);
    expect(() => parseState("not JSON")).toThrow(
      "Hub sync state could not be read or saved",
    );
    expect(() =>
      parseState(JSON.stringify({ ...state, schemaVersion: 2 })),
    ).toThrow();
    expect(() =>
      parseState(
        JSON.stringify({
          schemaVersion: 1,
          repositories: { "1": { ...persisted, content: "must-not-be-saved" } },
        }),
      ),
    ).toThrow();
  });
  it("마지막 성공 HEAD와 같을 때만 재처리를 건너뛴다", () => {
    expect(shouldSkip(record, "sha-a")).toBe(true);
    expect(shouldSkip(record, "sha-b")).toBe(false);
    expect(shouldSkip(undefined, "sha-a")).toBe(false);
    expect(shouldSkip(record, null)).toBe(false);
  });
});
