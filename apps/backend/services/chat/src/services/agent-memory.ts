import { z } from "zod";
import { extractJsonMiddleware, generateText, Output, wrapLanguageModel } from "ai";

import { MAX_MEMORY_CANDIDATES_PER_RUN } from "./agent-config.js";
import { createProviderModel } from "./agent-provider.js";
import type { ChatProvider } from "./agent-provider.js";
import {
  createMemoryCandidate,
  listActiveMemories,
  listMemoryDedupEntries,
  listPendingCandidates,
} from "./agent-state.js";

const MEMORY_CATEGORIES = ["preference", "profile", "project", "instruction"] as const;

const extractionSchema = z.object({
  candidates: z
    .array(
      z.object({
        category: z.enum(MEMORY_CATEGORIES),
        content: z.string().min(5).max(500),
        reason: z.string().min(1).max(200),
        supersedes_content: z.string().max(500).optional(),
      }),
    )
    .max(MAX_MEMORY_CANDIDATES_PER_RUN),
});

// Cheap signal gate: only spend an extraction LLM call when the latest user
// turn plausibly contains durable self-description. Keeps extraction low-freq.
const MEMORY_SIGNAL_PATTERNS: RegExp[] = [
  /\b(remember|from now on|going forward|in the future)\b/i,
  /\b(i (?:prefer|always|never|usually|hate|like|dislike)|my (?:favorite|favourite|preference))\b/i,
  /\b(call me|my name is|i work (?:as|at|for)|i'm a|i am a|my role|my team|my project|my company|i live in|i'm from|i am from)\b/i,
  /(喜欢|讨厌|偏好|习惯|总是|从来|记住|以后|叫我|我是|我的名字|我的角色|我负责|我的团队|我的项目|我住在|我来自)/,
];

export function hasMemorySignal(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  return MEMORY_SIGNAL_PATTERNS.some((re) => re.test(trimmed));
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractionInstructions(): string {
  return [
    "You distill durable, long-term memory about the user from a conversation turn.",
    "Only emit a candidate when the user reveals a NEW or CHANGED durable fact about themselves:",
    "stable preferences, profile facts (name/role/locale), ongoing projects, or standing instructions.",
    "Do NOT emit one-off task details, transient context, questions, the assistant's own output,",
    "secrets/credentials, health data, or anything sensitive unless the user explicitly asks to remember it.",
    "If a candidate updates/contradicts an existing memory, set supersedes_content to that existing memory's text.",
    "When nothing durable is present, return an empty candidates array. Returning empty is the common, correct case.",
    "Keep each content concise and self-contained (it will be read without conversation context).",
  ].join("\n");
}

function buildExtractionPrompt(input: {
  conversationText: string;
  existingMemories: Array<{ category: string; content: string }>;
}): string {
  const existing = input.existingMemories.length
    ? input.existingMemories.map((m) => `- (${m.category}) ${m.content}`).join("\n")
    : "(none)";
  return [
    "<existing_user_memory>",
    existing,
    "</existing_user_memory>",
    "",
    "<conversation_turn>",
    input.conversationText,
    "</conversation_turn>",
  ].join("\n");
}

export interface ExtractMemoryInput {
  userId: string;
  runId: string;
  provider: ChatProvider;
  userText: string;
}

export async function extractMemoryCandidates(input: ExtractMemoryInput): Promise<{ created: number }> {
  // Memory is grounded only in the latest user-authored text. Feeding the
  // assistant response or full history can turn model inferences into facts
  // and repeatedly re-extract stale turns.
  const conversationText = input.userText.trim().slice(-8_000);
  if (!hasMemorySignal(conversationText)) return { created: 0 };

  // Pull existing active + pending so the model can judge "new vs changed" and
  // we can dedup; rejected is pulled to avoid re-proposing declined memories.
  const [active, pending, dedupEntries] = await Promise.all([
    listActiveMemories(input.userId),
    listPendingCandidates(input.userId),
    listMemoryDedupEntries(input.userId),
  ]);
  const existingForPrompt = [
    ...active.map((m) => ({ category: m.category, content: m.content })),
    ...pending.map((m) => ({ category: m.category, content: m.content })),
  ];

  const baseModel = createProviderModel(input.provider, { disableReasoning: true });
  const structuredModel = wrapLanguageModel({ model: baseModel, middleware: extractJsonMiddleware() });

  let candidates: z.infer<typeof extractionSchema>["candidates"];
  try {
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: extractionSchema }),
      instructions: extractionInstructions(),
      prompt: buildExtractionPrompt({ conversationText, existingMemories: existingForPrompt }),
      maxOutputTokens: 1200,
      timeout: { totalMs: 60_000, stepMs: 60_000 },
    });
    candidates = result.output?.candidates ?? [];
  } catch (err) {
    console.error("[chat-agent] memory extraction failed", err);
    return { created: 0 };
  }

  if (!candidates.length) return { created: 0 };

  const seen = new Set(dedupEntries.map((m) => normalize(m.content)));
  let created = 0;
  for (const candidate of candidates) {
    const key = normalize(candidate.content);
    if (seen.has(key)) continue;
    seen.add(key);
    const supersedesId = candidate.supersedes_content
      ? active.find((m) => normalize(m.content) === normalize(candidate.supersedes_content ?? ""))?.id ?? null
      : null;
    await createMemoryCandidate({
      userId: input.userId,
      category: candidate.category,
      content: candidate.content,
      reason: candidate.reason,
      originRunId: input.runId,
      supersedesId,
    });
    created += 1;
  }
  return { created };
}
