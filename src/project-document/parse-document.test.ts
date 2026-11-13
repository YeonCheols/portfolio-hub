import { describe, expect, it } from "vitest";
import { PROJECT_GUIDANCE } from "./guidance.js";
import { parseProjectDocument } from "./parse-document.js";
const metadata = {
  schemaVersion: 1,
  slug: "fixture",
  title: "프로젝트",
  description: "설명",
  stacks: ["TypeScript", "Node.js"],
  linkGithub: "https://github.com/example/fixture",
};
const document = (
  value: unknown = metadata,
  content = "# 소개\n\n프로젝트 본문입니다.\n",
) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n\n${content}`;

describe("PROJECT.MD 고정 입력 규격", () => {
  it("JSON 메타데이터와 본문을 그대로 API 입력으로 변환하고 이미지 URL이 없으면 이미지 갱신 필드를 보내지 않는다", () => {
    expect(parseProjectDocument(document())).toEqual({
      slug: "fixture",
      title: "프로젝트",
      description: "설명",
      stacks: '["TypeScript","Node.js"]',
      content: "# 소개\n\n프로젝트 본문입니다.\n",
      linkDemo: null,
      linkGithub: metadata.linkGithub,
    });
    expect(
      parseProjectDocument(
        document({ ...metadata, image: "https://images.invalid/p.png" }),
      ).image,
    ).toBe("https://images.invalid/p.png");
  });
});

it("잘못된 버전·필수 필드·스택·URL·미허용 필드는 원문 없는 계약 오류로 거부한다", () => {
  for (const value of [
    null,
    { ...metadata, schemaVersion: 2 },
    { ...metadata, title: " " },
    { ...metadata, slug: "../private" },
    { ...metadata, stacks: "TypeScript" },
    { ...metadata, image: "./PROJECT.png" },
    { ...metadata, image: "data:image/png;base64,secret" },
    { ...metadata, linkDemo: "javascript:alert(1)" },
    { ...metadata, isShow: false },
    { ...metadata, description: "x".repeat(10001) },
  ]) {
    expect(() => parseProjectDocument(document(value))).toThrow(
      "Project document does not match the input contract",
    );
  }
  expect(() => parseProjectDocument("자유 형식 문서만 있습니다")).toThrow(
    "Project document does not match the input contract",
  );
});

it("각 저장소에 배포하는 지침의 JSON 예시가 실제 파서 규격과 일치한다", () => {
  const metadataBlock = PROJECT_GUIDANCE.match(/```json\n[\s\S]*?\n```/);
  expect(metadataBlock).not.toBeNull();
  expect(
    parseProjectDocument(`${metadataBlock![0]}\n\n소개입니다.`),
  ).toMatchObject({
    slug: "project-slug",
    image: "https://example.com/public-project.png",
    content: "소개입니다.",
  });
});

it("이미지 생략·null·빈 문자열은 업데이트 필드에서 제외한다", () => {
  for (const image of [undefined, null, ""]) {
    expect(
      parseProjectDocument(document({ ...metadata, image })),
    ).not.toHaveProperty("image");
  }
});
