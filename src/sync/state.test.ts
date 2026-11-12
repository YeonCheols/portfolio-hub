import { describe, expect, it } from "vitest";
import {
  shouldSkip,
  parseState,
  parseFailureHistory,
  failurePath,
  type RepositoryState,
} from "./state.js";

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

describe("failure history", () => {
  it("실패 정보의 오류 코드와 필드를 검증하고 한국 시간 날짜로 경로를 나눈다", () => {
    const failure = {
      repositoryId: 1,
      fullName: "side-projects-labs/demo",
      defaultBranch: "master",
      headSha: "b".repeat(40),
      failedAt: "2026-11-12T15:00:00.000Z",
      code: "REQUEST_FAILED",
    };
    const history = { schemaVersion: 1, failures: [failure] };
    expect(parseFailureHistory(JSON.stringify(history))).toEqual([failure]);
    expect(failurePath("2026-11-12T14:59:59.999Z")).toBe(
      "state/failures/2026-11-12/failures.json",
    );
    expect(failurePath(failure.failedAt)).toBe(
      "state/failures/2026-11-13/failures.json",
    );
    for (const invalid of [
      { ...history, schemaVersion: 2 },
      { ...history, failures: [{ ...failure, code: "secret-error-text" }] },
      { ...history, failures: [{ ...failure, content: "private-source" }] },
      { ...history, failures: [{ ...failure, headSha: "invalid" }] },
      { ...history, failures: [{ ...failure, failedAt: "invalid" }] },
    ])
      expect(() => parseFailureHistory(JSON.stringify(invalid))).toThrow();
    expect(
      parseFailureHistory(
        JSON.stringify({
          schemaVersion: 1,
          failures: [{ ...failure, headSha: null }],
        }),
      ),
    ).toHaveLength(1);
  });
});
