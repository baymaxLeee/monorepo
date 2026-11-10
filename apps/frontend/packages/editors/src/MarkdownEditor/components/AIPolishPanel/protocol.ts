interface AiPolishResultBlock {
  content: string;
  type: string;
}

const isResultBlock = (value: unknown): value is AiPolishResultBlock =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "content") === "string" &&
  typeof Reflect.get(value, "type") === "string";

export const parseAiPolishResult = (value: string, expectedCount: number): string[] => {
  if (!value.trim()) {
    throw new TypeError("AI 润色未返回内容");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("AI 润色返回格式无效");
  }

  if (!Array.isArray(parsed) || parsed.length !== expectedCount || !parsed.every(isResultBlock)) {
    throw new TypeError(`AI 润色返回格式无效，应包含 ${expectedCount} 个文本块`);
  }

  const texts = parsed.map((item) => item.content);
  if (!texts.some((text) => text.trim())) {
    throw new TypeError("AI 润色未返回内容");
  }

  return texts;
};
