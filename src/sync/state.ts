export type RepositoryState = {
  repositoryId: number;
  fullName: string;
  defaultBranch: string;
  lastSuccessfulHeadSha: string | null;
  lastSuccessfulAt: string | null;
  lastResult: "success" | "failure";
  lastErrorCode: string | null;
};

export type SyncState = {
  schemaVersion: 1;
  repositories: Record<string, RepositoryState>;
};
export type FailureRecord = {
  repositoryId: number;
  fullName: string;
  defaultBranch: string;
  headSha: string | null;
  failedAt: string;
  code: string;
};
export type StateStore = {
  load: () => Promise<SyncState>;
  save: (state: SyncState, failures?: FailureRecord[]) => Promise<void>;
};
export const emptyState = (): SyncState => ({
  schemaVersion: 1,
  repositories: {},
});
export class StateStorageError extends Error {
  readonly code = "STATE_STORAGE_FAILED";
  constructor() {
    super("Hub sync state could not be read or saved");
    this.name = "StateStorageError";
  }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const recordKeys = [
  "repositoryId",
  "fullName",
  "defaultBranch",
  "lastSuccessfulHeadSha",
  "lastSuccessfulAt",
  "lastResult",
  "lastErrorCode",
];
const errorCodes = new Set([
  "AUTHENTICATION_FAILED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "REQUEST_FAILED",
  "EMPTY_REPOSITORY",
  "CONTENT_INCOMPLETE",
]);
const isRecord = (value: unknown): value is RepositoryState => {
  if (
    !isObject(value) ||
    Object.keys(value).length !== recordKeys.length ||
    !recordKeys.every((key) => Object.hasOwn(value, key))
  )
    return false;
  if (
    !Number.isSafeInteger(value.repositoryId) ||
    typeof value.repositoryId !== "number" ||
    value.repositoryId <= 0
  )
    return false;
  if (
    typeof value.fullName !== "string" ||
    !/^side-projects-labs\/[A-Za-z0-9_.-]+$/.test(value.fullName)
  )
    return false;
  if (typeof value.defaultBranch !== "string" || !value.defaultBranch)
    return false;
  if (
    value.lastSuccessfulHeadSha !== null &&
    (typeof value.lastSuccessfulHeadSha !== "string" ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.lastSuccessfulHeadSha))
  )
    return false;
  if (
    value.lastSuccessfulAt !== null &&
    (typeof value.lastSuccessfulAt !== "string" ||
      !Number.isFinite(Date.parse(value.lastSuccessfulAt)))
  )
    return false;
  if (
    (value.lastSuccessfulHeadSha === null) !==
    (value.lastSuccessfulAt === null)
  )
    return false;
  if (value.lastResult === "success")
    return value.lastSuccessfulHeadSha !== null && value.lastErrorCode === null;
  return (
    value.lastResult === "failure" &&
    typeof value.lastErrorCode === "string" &&
    errorCodes.has(value.lastErrorCode)
  );
};
export const parseState = (text: string): SyncState => {
  try {
    const value: unknown = JSON.parse(text);
    if (
      !isObject(value) ||
      value.schemaVersion !== 1 ||
      Object.keys(value).length !== 2 ||
      !isObject(value.repositories)
    )
      throw new StateStorageError();
    const repositories: Record<string, RepositoryState> = {};
    for (const [id, record] of Object.entries(value.repositories)) {
      if (!isRecord(record) || id !== String(record.repositoryId))
        throw new StateStorageError();
      repositories[id] = record;
    }
    return { schemaVersion: 1, repositories };
  } catch {
    throw new StateStorageError();
  }
};
export const shouldSkip = (
  record: RepositoryState | undefined,
  head: string | null,
): boolean => head !== null && record?.lastSuccessfulHeadSha === head;

export const parseFailureHistory = (text: string): FailureRecord[] => {
  try {
    const value: unknown = JSON.parse(text);
    if (
      !isObject(value) ||
      value.schemaVersion !== 1 ||
      Object.keys(value).length !== 2 ||
      !Array.isArray(value.failures)
    )
      throw new StateStorageError();
    return value.failures.map((item: unknown) => {
      if (
        !isObject(item) ||
        Object.keys(item).length !== 6 ||
        typeof item.failedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
          item.failedAt,
        ) ||
        !Number.isFinite(Date.parse(item.failedAt)) ||
        !isRecord({
          repositoryId: item.repositoryId,
          fullName: item.fullName,
          defaultBranch: item.defaultBranch,
          lastSuccessfulHeadSha: item.headSha,
          lastSuccessfulAt: item.headSha === null ? null : item.failedAt,
          lastResult: "failure",
          lastErrorCode: item.code,
        })
      )
        throw new StateStorageError();
      return {
        repositoryId: Number(item.repositoryId),
        fullName: String(item.fullName),
        defaultBranch: String(item.defaultBranch),
        headSha: item.headSha === null ? null : String(item.headSha),
        failedAt: item.failedAt,
        code: String(item.code),
      };
    });
  } catch {
    throw new StateStorageError();
  }
};
export const failurePath = (failedAt: string): string => {
  const day = new Date(Date.parse(failedAt) + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `state/failures/${day}/failures.json`;
};
