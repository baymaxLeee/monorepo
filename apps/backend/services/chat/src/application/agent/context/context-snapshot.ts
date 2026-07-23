import type {
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
  LanguageModelV4ProviderTool,
} from "@ai-sdk/provider";

import type { UsageTokens } from "../observability/lifecycle.js";
import type { ToolSource } from "../tools/types.js";
import { INSTRUCTION_SECTION_TAGS } from "./instructions/section-tags.js";

export const CONTEXT_CATEGORY_IDS = [
  "system",
  "tools",
  "rules",
  "skills",
  "mcp",
  "memory",
  "conversation",
] as const;

export type ContextCategoryId = (typeof CONTEXT_CATEGORY_IDS)[number];

export interface ContextCategoryUsage {
  id: ContextCategoryId;
  tokens: number;
}

export interface ContextEstimate {
  categories: ContextCategoryUsage[];
}

export interface ConversationContextSnapshot {
  version: 1;
  usedTokens: number;
  inputTokens: number;
  retainedOutputTokens: number;
  breakdownEstimated: true;
  categories: ContextCategoryUsage[];
}

type ProviderTool = LanguageModelV4FunctionTool | LanguageModelV4ProviderTool;

const SYSTEM_TAGS = [
  INSTRUCTION_SECTION_TAGS.corePolicy,
  INSTRUCTION_SECTION_TAGS.botProfile,
  INSTRUCTION_SECTION_TAGS.environment,
];
const RULE_TAGS = [
  INSTRUCTION_SECTION_TAGS.runtimeContract,
  INSTRUCTION_SECTION_TAGS.executionProtocol,
  INSTRUCTION_SECTION_TAGS.capabilityContract,
  INSTRUCTION_SECTION_TAGS.orchestrationDirective,
];
const SKILL_TAGS = [
  INSTRUCTION_SECTION_TAGS.availableSkills,
  INSTRUCTION_SECTION_TAGS.activatedSkill,
];
const MEMORY_TAGS = [INSTRUCTION_SECTION_TAGS.userMemoryData];

function estimateTokens(value: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

function serialized(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (key, current) => {
      if (key === "providerOptions") return undefined;
      if (current instanceof Uint8Array) return `[binary:${current.byteLength}]`;
      if (current && typeof current === "object") {
        if (seen.has(current)) return "[circular]";
        seen.add(current);
      }
      if (
        typeof current === "string" &&
        current.length > 2_048 &&
        (/^data:[^;]+;base64,/.test(current) ||
          /^[A-Za-z0-9+/=\r\n]+$/.test(current.slice(0, 512)))
      ) {
        return `[binary:${current.length}]`;
      }
      return current;
    }) ?? ""
  );
}

function tagContent(source: string, tags: string[]): string {
  const matches: string[] = [];
  for (const tag of tags) {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g");
    matches.push(...(source.match(pattern) ?? []));
  }
  return matches.join("\n");
}

function instructionCategories(prompt: LanguageModelV4Prompt): Record<ContextCategoryId, number> {
  const totals = emptyTotals();
  const instructions = prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  if (!instructions) return totals;

  const system = tagContent(instructions, SYSTEM_TAGS);
  const rules = tagContent(instructions, RULE_TAGS);
  const skills = tagContent(instructions, SKILL_TAGS);
  const memory = tagContent(instructions, MEMORY_TAGS);
  totals.system = estimateTokens(system);
  totals.rules = estimateTokens(rules);
  totals.skills = estimateTokens(skills);
  totals.memory = estimateTokens(memory);

  const categorized = [system, rules, skills, memory].join("\n");
  totals.system += Math.max(0, estimateTokens(instructions) - estimateTokens(categorized));
  return totals;
}

function emptyTotals(): Record<ContextCategoryId, number> {
  return Object.fromEntries(CONTEXT_CATEGORY_IDS.map((id) => [id, 0])) as Record<
    ContextCategoryId,
    number
  >;
}

export function estimateConversationContext(input: {
  prompt: LanguageModelV4Prompt;
  tools?: ProviderTool[];
  toolSources: ReadonlyMap<string, ToolSource>;
}): ContextEstimate {
  const totals = instructionCategories(input.prompt);
  const skillConversationParts: unknown[] = [];
  const conversation = input.prompt
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (!Array.isArray(message.content)) return message;
      return {
        ...message,
        content: message.content.filter((part) => {
          if (!part || typeof part !== "object" || !("toolName" in part)) {
            return true;
          }
          const toolName = part.toolName;
          if (
            typeof toolName !== "string" ||
            input.toolSources.get(toolName) !== "skill"
          ) {
            return true;
          }
          skillConversationParts.push(part);
          return false;
        }),
      };
    });
  totals.conversation = estimateTokens(serialized(conversation));
  totals.skills += estimateTokens(serialized(skillConversationParts));

  for (const tool of input.tools ?? []) {
    const name = "name" in tool ? tool.name : "";
    const source = input.toolSources.get(name) ?? "builtin";
    const tokens = estimateTokens(serialized(tool));
    if (source === "mcp") totals.mcp += tokens;
    else if (source === "skill") totals.skills += tokens;
    else totals.tools += tokens;
  }

  return {
    categories: CONTEXT_CATEGORY_IDS.map((id) => ({ id, tokens: totals[id] })),
  };
}

export function finalizeConversationContext(
  estimate: ContextEstimate | undefined,
  usage: UsageTokens,
): ConversationContextSnapshot | null {
  if (!estimate) return null;
  const estimatedInput = estimate.categories.reduce((sum, item) => sum + item.tokens, 0);
  const inputTokens =
    usage.inputTokens != null && usage.inputTokens > 0
      ? usage.inputTokens
      : estimatedInput;
  const retainedOutputTokens = Math.max(
    0,
    (usage.outputTokens ?? 0) - (usage.reasoningTokens ?? 0),
  );
  const scaled = estimate.categories.map((category) => ({ ...category }));

  if (estimatedInput > inputTokens && estimatedInput > 0) {
    for (const category of scaled) {
      category.tokens = Math.floor((category.tokens * inputTokens) / estimatedInput);
    }
  }
  const scaledInput = scaled.reduce((sum, item) => sum + item.tokens, 0);
  const conversation = scaled.find((item) => item.id === "conversation")!;
  conversation.tokens += inputTokens - scaledInput + retainedOutputTokens;

  return {
    version: 1,
    usedTokens: inputTokens + retainedOutputTokens,
    inputTokens,
    retainedOutputTokens,
    breakdownEstimated: true,
    categories: scaled.filter((category) => category.tokens > 0),
  };
}

export function parseConversationContextSnapshot(
  value: unknown,
): ConversationContextSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<ConversationContextSnapshot>;
  if (
    snapshot.version !== 1 ||
    typeof snapshot.usedTokens !== "number" ||
    typeof snapshot.inputTokens !== "number" ||
    typeof snapshot.retainedOutputTokens !== "number" ||
    !Array.isArray(snapshot.categories)
  ) {
    return null;
  }
  const categories = snapshot.categories.filter(
    (category): category is ContextCategoryUsage =>
      Boolean(
        category &&
          typeof category === "object" &&
          CONTEXT_CATEGORY_IDS.includes(category.id as ContextCategoryId) &&
          typeof category.tokens === "number" &&
          Number.isFinite(category.tokens) &&
          category.tokens >= 0,
      ),
  );
  return categories.length === snapshot.categories.length
    ? { ...snapshot, breakdownEstimated: true, categories } as ConversationContextSnapshot
    : null;
}
