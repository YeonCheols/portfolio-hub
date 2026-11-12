export type ApplicationState = {
  repositoryId: number;
  slug: string | null;
  targetHash: string;
  lastSuccessfulHeadSha: string | null;
  lastSuccessfulAt: string | null;
  payloadHash: string | null;
  lastResult: "success" | "failure" | "pending";
  lastErrorCode: string | null;
};
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
  applications?: Record<string, ApplicationState>;
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
      Object.keys(value).some(
        (key) =>
          !["schemaVersion", "repositories", "applications"].includes(key),
      ) ||
      !isObject(value.repositories)
    )
      throw new StateStorageError();
    const repositories: Record<string, RepositoryState> = {};
    for (const [id, record] of Object.entries(value.repositories)) {
      if (!isRecord(record) || id !== String(record.repositoryId))
        throw new StateStorageError();
      repositories[id] = record;
    }
    const applications: Record<string, ApplicationState> = {};
    if (Object.hasOwn(value, "applications")) {
      if (!isObject(value.applications)) throw new StateStorageError();
      const applicationErrors = new Set([
        "REQUEST_FAILED",
        "PROJECT_DOCUMENT_MISSING",
        "PROJECT_DOCUMENT_UNREADABLE",
        "PROJECT_DOCUMENT_TOO_LARGE",
        "PROJECT_DOCUMENT_INVALID",
        "PORTFOLIO_API_AUTH_FAILED",
        "PORTFOLIO_API_REQUEST_FAILED",
        "PORTFOLIO_API_INVALID_RESPONSE",
        "PORTFOLIO_API_INVALID_INPUT",
        "PORTFOLIO_API_CONFIGURATION_INVALID",
      ]);
      const nullableSha = (input: unknown) =>
        input === null ||
        (typeof input === "string" &&
          /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input));
      for (const [id, item] of Object.entries(value.applications)) {
        const fields = [
          "repositoryId",
          "slug",
          "targetHash",
          "lastSuccessfulHeadSha",
          "lastSuccessfulAt",
          "payloadHash",
          "lastResult",
          "lastErrorCode",
        ];
        if (
          !isObject(item) ||
          Object.keys(item).length !== fields.length ||
          !fields.every((key) => Object.hasOwn(item, key)) ||
          !Number.isSafeInteger(item.repositoryId) ||
          typeof item.repositoryId !== "number" ||
          item.repositoryId <= 0 ||
          id !== String(item.repositoryId) ||
          typeof item.targetHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(item.targetHash) ||
          !nullableSha(item.lastSuccessfulHeadSha) ||
          (item.lastSuccessfulAt !== null &&
            (typeof item.lastSuccessfulAt !== "string" ||
              !Number.isFinite(Date.parse(item.lastSuccessfulAt)))) ||
          (item.slug !== null &&
            (typeof item.slug !== "string" ||
              !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(item.slug))) ||
          (item.payloadHash !== null &&
            (typeof item.payloadHash !== "string" ||
              !/^[a-f0-9]{64}$/.test(item.payloadHash)))
        )
          throw new StateStorageError();
        if (
          (item.lastSuccessfulHeadSha === null) !==
            (item.lastSuccessfulAt === null) ||
          (item.lastSuccessfulHeadSha === null) !==
            (item.payloadHash === null) ||
          (item.lastSuccessfulHeadSha === null) !== (item.slug === null)
        )
          throw new StateStorageError();
        if (
          item.lastResult === "success"
            ? item.lastSuccessfulHeadSha === null || item.lastErrorCode !== null
            : !["failure", "pending"].includes(String(item.lastResult)) ||
              typeof item.lastErrorCode !== "string" ||
              !applicationErrors.has(item.lastErrorCode) ||
              (item.lastResult === "pending" &&
                item.lastErrorCode !== "PROJECT_DOCUMENT_MISSING")
        )
          throw new StateStorageError();
        applications[id] = item as ApplicationState;
      }
    }
    return {
      schemaVersion: 1,
      repositories,
      ...(Object.hasOwn(value, "applications") ? { applications } : {}),
    };
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
