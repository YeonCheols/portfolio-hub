import type { ProjectPayload } from "../portfolio-api/client.js";
export class ProjectContractError extends Error {
  readonly code = "PROJECT_DOCUMENT_INVALID";
  constructor() {
    super("Project document does not match the input contract");
  }
}
export const parseProjectDocument = (markdown: string): ProjectPayload => {
  try {
    const match =
      /^```json\r?\n([\s\S]*?)\r?\n```\r?\n(?:\r?\n)?([\s\S]*)$/.exec(markdown);
    if (!match) throw new ProjectContractError();
    const data: unknown = JSON.parse(match[1]);
    if (data === null || typeof data !== "object" || Array.isArray(data))
      throw new ProjectContractError();
    const value = data as Record<string, unknown>;
    const keys = new Set([
      "schemaVersion",
      "slug",
      "title",
      "description",
      "image",
      "stacks",
      "linkDemo",
      "linkGithub",
    ]);
    if (
      Object.keys(value).some((key) => !keys.has(key)) ||
      value.schemaVersion !== 1 ||
      typeof value.slug !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value.slug) ||
      typeof value.title !== "string" ||
      !value.title.trim() ||
      value.title.length > 500 ||
      typeof value.description !== "string" ||
      value.description.length > 10000 ||
      !Array.isArray(value.stacks) ||
      !value.stacks.every((item: unknown) => typeof item === "string") ||
      JSON.stringify(value.stacks).length > 10000 ||
      match[2].length > 262144
    )
      throw new ProjectContractError();
    const link = (input: unknown): string | null => {
      if (input === undefined || input === null || input === "") return null;
      if (typeof input !== "string" || input.length > 4096)
        throw new ProjectContractError();
      const url = new URL(input);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new ProjectContractError();
      return input;
    };
    const image = link(value.image);
    return {
      slug: value.slug,
      title: value.title,
      description: value.description,
      ...(image === null ? {} : { image }),
      stacks: JSON.stringify(value.stacks),
      content: match[2],
      linkDemo: link(value.linkDemo),
      linkGithub: link(value.linkGithub),
    };
  } catch {
    throw new ProjectContractError();
  }
};
