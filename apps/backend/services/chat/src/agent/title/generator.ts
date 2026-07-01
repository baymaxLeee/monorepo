import { generateText } from "ai";

import { createProviderModel } from "@backend/transport-ts/provider-model";
import type { ChatProvider } from "@backend/transport-ts/provider-model";

// A sidebar entry has to stay glanceable; anything longer is truncated with an
// ellipsis rather than trusting the model to count characters.
const MAX_TITLE_CHARS = 40;

// Mirrors the Vercel Chat SDK's `generateTitleFromUserMessage`: a tiny, single
// call that summarizes the user's opening message into a short label. Kept
// language-agnostic and stripped of the decorations models like to add
// (surrounding quotes, a "Title:" prefix, a trailing period).
const TITLE_INSTRUCTIONS = [
  "You generate a short, descriptive title for a chat based on the user's first message.",
  "Rules:",
  "- Summarize the user's intent in at most 6 words (or ~16 Chinese characters).",
  "- Write the title in the same language as the user's message.",
  "- Output the title text only: no quotes, no surrounding punctuation, no prefix such as \"Title:\".",
  "- Do not answer the question, translate it, or add any commentary.",
].join("\n");

function sanitizeTitle(raw: string): string {
  let title = raw.trim();
  // Strip a leading "Title:"/"标题:" the model sometimes prepends.
  title = title.replace(/^\s*(title|标题)\s*[:：]\s*/i, "");
  // Strip wrapping quotes (ASCII + CJK) if the whole line is quoted.
  title = title.replace(/^["'“”『「《]+/, "").replace(/["'“”』」》]+$/, "");
  title = title.replace(/\s+/g, " ").trim();
  // Drop trailing sentence punctuation — a title is a fragment, not a sentence.
  title = title.replace(/[。.!！?？,，、;；:：\s]+$/g, "").trim();
  if ([...title].length > MAX_TITLE_CHARS) {
    title = `${[...title].slice(0, MAX_TITLE_CHARS).join("").trim()}…`;
  }
  return title;
}

// Best-effort: returns a clean title, or null when generation is impossible or
// fails. Callers must treat a null as "keep the current title" — title
// generation is a cosmetic enhancement and must never break or block the chat.
export async function generateConversationTitle(input: {
  provider: ChatProvider;
  userText: string;
}): Promise<string | null> {
  const source = input.userText.trim().slice(0, 4_000);
  if (source.length < 2) return null;
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
    console.error("[chat-agent] title generation failed (non-fatal)", error);
    return null;
  }
}
