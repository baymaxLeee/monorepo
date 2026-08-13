import { createProviderModel } from "@backend/transport-ts/provider-model";
import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { generateText } from "ai";

import { logger } from "../../../infrastructure/observability/logger.js";

const MAX_TITLE_CHARS = 40;

const TITLE_INSTRUCTIONS = [
  "You generate a short, descriptive title for a chat based on the user's first message.",
  "Rules:",
  "- Summarize the user's intent in at most 6 words (or ~16 Chinese characters).",
  "- Write the title in the same language as the user's message.",
  '- Output the title text only: no quotes, no surrounding punctuation, no prefix such as "Title:".',
  "- Do not answer the question, translate it, or add any commentary.",
].join("\n");

function sanitizeTitle(raw: string): string {
  let title = raw.trim();
  title = title.replace(/^\s*(title|标题)\s*[:：]\s*/i, "");
  title = title.replace(/^["'“”『「《]+/, "").replace(/["'“”』」》]+$/, "");
  title = title.replace(/\s+/g, " ").trim();
  title = title.replace(/[。.!！?？,，、;；:：\s]+$/g, "").trim();
  if ([...title].length > MAX_TITLE_CHARS) {
    title = `${[...title].slice(0, MAX_TITLE_CHARS).join("").trim()}…`;
  }
  return title;
}

export async function generateConversationTitle(input: {
  provider: LanguageProviderSnapshot;
  userText: string;
}): Promise<string | null> {
  const source = input.userText.trim().slice(0, 4_000);
  if (source.length < 2) {
    return null;
  }
  try {
    const model = createProviderModel(input.provider, { disableReasoning: true });
    const result = await generateText({
      model,
      instructions: TITLE_INSTRUCTIONS,
      prompt: source,
      maxOutputTokens: 64,
      timeout: { totalMs: 20_000, stepMs: 20_000 },
    });
    const title = sanitizeTitle(result.text ?? "");
    return title.length ? title : null;
  } catch (error) {
    logger.error({ err: error }, "title generation failed (non-fatal)");
    return null;
  }
}
