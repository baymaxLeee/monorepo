import type { UIMessage } from "ai";
import { documentIdFromFilePart } from "./file-parts.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

export interface CompactionState {
  goals: string[];
  constraints: string[];
  decisions: string[];
  completedWork: string[];
  openQuestions: string[];
  documentReferences: string[];
  planDocumentId: string | null;
  mode: "normal" | "plan";
}

const GOAL_PATTERNS = [/目标[是为：:]\s*(.+)/i, /please\s+(.{8,120})/i, /帮我\s+(.{4,120})/i];
const CONSTRAINT_PATTERNS = [/约束[是为：:]\s*(.+)/i, /必须\s+(.{4,120})/i, /不要\s+(.{4,120})/i];
const DECISION_PATTERNS = [/决定\s+(.{4,160})/i, /采用\s+(.{4,160})/i, /选择\s+(.{4,160})/i];
const QUESTION_PATTERNS = [/\?\s*$/m, /吗[？?]?\s*$/m, /如何\s+(.{4,120})/i];

function uniqueLimited(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const trimmed = value.trim().slice(0, 240);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    rows.push(trimmed);
    if (rows.length >= limit) break;
  }
  return rows;
}

function messageText(message: AnyUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function extractMatches(text: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((pattern) => {
    const match = text.match(pattern);
    return match?.[1] ? [match[1].trim()] : [];
  });
}

function completedWorkFromMessage(message: AnyUIMessage): string[] {
  return message.parts.flatMap((part) => {
    if (!part.type.startsWith("tool-") || !("state" in part) || part.state !== "output-available") return [];
    const name = part.type.slice(5);
    const output = "output" in part && part.output && typeof part.output === "object"
      ? part.output as Record<string, unknown>
      : null;
    if (!output) return [`${name} completed`];
    if (output.document_id) return [`${name} -> document ${String(output.document_id)}`];
    if (output.status === "persisted") return [`${name} persisted`];
    return [`${name} completed`];
  });
}

export function buildCompactionState(input: {
  messages: AnyUIMessage[];
  mode: "normal" | "plan";
  activePlanDocumentId: string | null;
  previous?: Partial<CompactionState> | null;
}): CompactionState {
  const documentReferences = [...new Set([
    ...(input.previous?.documentReferences ?? []),
    ...input.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type === "file") {
          const id = documentIdFromFilePart(part);
          return id ? [id] : [];
        }
        return [];
      }),
    ),
  ])].slice(-32);

  const goals: string[] = [];
  const constraints: string[] = [];
  const decisions: string[] = [];
  const completedWork: string[] = [];
  const openQuestions: string[] = [];

  for (const message of input.messages) {
    const text = messageText(message);
    if (message.role === "user" && text) {
      goals.push(...extractMatches(text, GOAL_PATTERNS));
      if (!goals.length) goals.push(text.slice(0, 160));
      constraints.push(...extractMatches(text, CONSTRAINT_PATTERNS));
      openQuestions.push(...extractMatches(text, QUESTION_PATTERNS));
    }
    if (message.role === "assistant" && text) {
      decisions.push(...extractMatches(text, DECISION_PATTERNS));
      if (text.includes("?") || text.includes("？")) {
        openQuestions.push(text.split(/[?\？]/)[0]?.slice(-120) ?? "");
      }
    }
    completedWork.push(...completedWorkFromMessage(message));
  }

  return {
    goals: uniqueLimited([...(input.previous?.goals ?? []), ...goals], 8),
    constraints: uniqueLimited([...(input.previous?.constraints ?? []), ...constraints], 8),
    decisions: uniqueLimited([...(input.previous?.decisions ?? []), ...decisions], 10),
    completedWork: uniqueLimited([...(input.previous?.completedWork ?? []), ...completedWork], 16),
    openQuestions: uniqueLimited([...(input.previous?.openQuestions ?? []), ...openQuestions], 8),
    documentReferences,
    planDocumentId: input.activePlanDocumentId,
    mode: input.mode,
  };
}
