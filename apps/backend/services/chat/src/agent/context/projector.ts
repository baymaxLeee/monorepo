import { convertToModelMessages, pruneMessages, type ModelMessage, type UIMessage } from "ai";
import { and, eq } from "drizzle-orm";

import { getDocument, getDocumentSource } from "../../clients/knowledge.js";
import { getDb } from "../../db/index.js";
import { conversationContexts } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { latestCompletedToolOutput } from "../runs/repository.js";
import { buildCompactionState, type CompactionState } from "./compaction-state.js";
import type { InstructionContextBlock } from "./instructions/index.js";
import {
  documentIdFromFilePart,
  isImageMediaType,
} from "./file-parts.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

const MAX_SUMMARY_CHARS = 12_000;
const MAX_STATE_CHARS = 20_000;
const MAX_PLAN_CHARS = 40_000;
const CONTEXT_OVERHEAD_TOKENS = 4_000;

function textParts(message: AnyUIMessage): string {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "source-url") return [`source: ${part.title ?? part.url} ${part.url}`];
      if (part.type.startsWith("tool-") && "state" in part && part.state === "output-available") {
        const name = part.type.slice(5);
        const output = "output" in part && part.output && typeof part.output === "object"
          ? part.output as Record<string, unknown>
          : null;
        const reference = output && (
          output.document_id ?? output.file_id ?? output.url ?? output.status
        );
        return [`tool ${name}${reference ? `: ${String(reference)}` : " completed"}`];
      }
      return [];
    })
    .join("\n")
    .trim();
}

function compactOlderMessages(messages: AnyUIMessage[]): string {
  return messages
    .map((message) => {
      const text = textParts(message);
      return text ? `${message.role}: ${text.slice(0, 1_200)}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(-MAX_SUMMARY_CHARS);
}

interface TodoSnapshotItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  deliverable?: "artifact" | "image" | "video";
}

function parseTodoSnapshot(output: unknown): TodoSnapshotItem[] | null {
  if (!output || typeof output !== "object") return null;
  const todos = (output as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  return todos.filter(
    (item): item is TodoSnapshotItem =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).content === "string" &&
      typeof (item as Record<string, unknown>).status === "string",
  );
}

function estimatedMessageChars(message: AnyUIMessage): number {
  try {
    return JSON.stringify(message.parts).length + 200;
  } catch {
    return textParts(message).length + 400;
  }
}

async function saveSnapshot(
  conversationId: string,
  coveredThroughMessageId: string | null,
  summary: string,
  state: Record<string, unknown>,
): Promise<void> {
  if (!summary) return;
  const db = getDb();
  const [current] = await db
    .select()
    .from(conversationContexts)
    .where(eq(conversationContexts.conversationId, conversationId));
  const now = new Date();
  const values = {
      conversationId,
      revision: (current?.revision ?? 0) + 1,
      coveredThroughMessageId,
      summary,
      stateJson: state,
      estimatedTokens: Math.ceil(summary.length / 4),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
  };
  if (current) {
    await db.update(conversationContexts).set({
        revision: current.revision + 1,
        coveredThroughMessageId,
        summary,
        stateJson: state,
        estimatedTokens: Math.ceil(summary.length / 4),
        updatedAt: now,
      }).where(and(
        eq(conversationContexts.conversationId, conversationId),
        eq(conversationContexts.revision, current.revision),
      ));
    return;
  }
  try {
    await db.insert(conversationContexts).values(values);
  } catch {
  }
}

async function transformUserFilePartsForModel(
  messages: AnyUIMessage[],
  userId: string,
  supportsImageInput: boolean,
): Promise<AnyUIMessage[]> {
  // Only inline images for vision models: non-vision chat models (Ark et al.)
  // reject image parts outright, so otherwise images degrade to a text reference.
  const imageFiles = new Map<string, { data: Uint8Array; filename: string; mediaType: string }>();
  if (supportsImageInput) {
    const imageDocIds = new Set<string>();
    for (const message of messages) {
      if (message.role !== "user") continue;
      for (const part of message.parts) {
        if (part.type !== "file") continue;
        const docId = documentIdFromFilePart(part);
        if (docId && isImageMediaType(String(part.mediaType ?? ""))) {
          imageDocIds.add(docId);
        }
      }
    }

    await Promise.all([...imageDocIds].map(async (documentId) => {
      try {
        const source = await getDocumentSource(userId, documentId);
        const part = messages
          .flatMap((message) => (message.role === "user" ? message.parts : []))
          .find((candidate) => candidate.type === "file" && documentIdFromFilePart(candidate) === documentId);
        imageFiles.set(documentId, {
          data: source.bytes,
          filename:
            (part?.type === "file" ? part.filename : undefined) || "image",
          mediaType: source.mimeType || "application/octet-stream",
        });
      } catch (error) {
        logger.error({ err: error }, "failed to load image attachment");
      }
    }));
  }

  return messages.map((message) => {
    if (message.role !== "user") return message;
    return {
      ...message,
      parts: message.parts.flatMap((part): AnyUIMessage["parts"] => {
        if (part.type !== "file") return [part];
        const docId = documentIdFromFilePart(part);
        if (!docId) return [];
        const mediaType = String(part.mediaType ?? "application/octet-stream");
        if (isImageMediaType(mediaType)) {
          const image = imageFiles.get(docId);
          if (image) {
            const base64 = Buffer.from(image.data).toString("base64");
            return [{
              type: "file" as const,
              mediaType: image.mediaType,
              filename: image.filename,
              url: `data:${image.mediaType};base64,${base64}`,
            }];
          }
        }
        const reference = JSON.stringify({
          documentId: docId,
          filename: String(part.filename ?? ""),
          mediaType,
        }).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
        return [{
          type: "text" as const,
          text: `<document_reference>${reference}</document_reference>`,
        }];
      }),
    } as AnyUIMessage;
  });
}

export async function projectModelContext(input: {
  conversationId: string;
  userId: string;
  mode: "normal" | "plan";
  activePlanDocumentId: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImageInput: boolean;
  messages: AnyUIMessage[];
}): Promise<{ messages: ModelMessage[]; instructionContext: InstructionContextBlock[] }> {
  const inputTokenBudget = Math.max(
    512,
    input.contextWindow - input.maxOutputTokens - CONTEXT_OVERHEAD_TOKENS,
  );
  const [stored] = await getDb()
    .select()
    .from(conversationContexts)
    .where(eq(conversationContexts.conversationId, input.conversationId));
  const storedState = stored?.stateJson && typeof stored.stateJson === "object"
    ? stored.stateJson as Partial<CompactionState>
    : null;
  let state: Partial<CompactionState> | null = storedState;
  const stateReserve = storedState
    ? Math.min(MAX_STATE_CHARS, JSON.stringify(storedState).length)
    : 0;
  const planReserve = input.mode === "plan" && input.activePlanDocumentId
    ? Math.min(MAX_PLAN_CHARS, Math.floor(inputTokenBudget * 1.5))
    : 0;
  const charBudget = Math.max(
    1_500,
    inputTokenBudget * 3 - MAX_SUMMARY_CHARS - stateReserve - planReserve,
  );
  let recentChars = 0;
  let splitAt = input.messages.length;
  while (splitAt > 0) {
    const next = estimatedMessageChars(input.messages[splitAt - 1]!);
    if (recentChars + next > charBudget && splitAt < input.messages.length) break;
    recentChars += next;
    splitAt -= 1;
  }
  const older = input.messages.slice(0, splitAt);
  const recent = input.messages.slice(splitAt);

  let summary = stored?.summary ?? "";
  if (older.length) {
    const coveredIndex = stored?.coveredThroughMessageId
      ? older.findIndex((message) => message.id === stored.coveredThroughMessageId)
      : -1;
    const newlyOlder = coveredIndex >= 0 ? older.slice(coveredIndex + 1) : older;
    if (newlyOlder.length) {
      const addition = compactOlderMessages(newlyOlder);
      summary = (coveredIndex >= 0 && stored?.summary
        ? `${stored.summary}\n\n${addition}`
        : addition
      ).slice(-MAX_SUMMARY_CHARS);
      state = buildCompactionState({
        messages: newlyOlder,
        mode: input.mode,
        activePlanDocumentId: input.activePlanDocumentId,
        previous: storedState,
      });
      void saveSnapshot(input.conversationId, older.at(-1)?.id ?? null, summary, state as unknown as Record<string, unknown>).catch((error) =>
        logger.error({ err: error }, "failed to persist snapshot"),
      );
    }
  }

  const instructionContext: InstructionContextBlock[] = [];
  if (summary) {
    instructionContext.push({ kind: "conversation_summary", body: summary });
  }
  if (state) {
    instructionContext.push({ kind: "conversation_state", body: JSON.stringify(state) });
  }

  const todoSnapshot = parseTodoSnapshot(
    await latestCompletedToolOutput(input.conversationId, "update_todos"),
  );
  if (todoSnapshot) {
    instructionContext.push({ kind: "current_todo_list", body: JSON.stringify(todoSnapshot) });
  }

  if (input.mode === "plan" && input.activePlanDocumentId) {
    try {
      const plan = await getDocument(input.userId, input.activePlanDocumentId);
      if (plan.conversation_id === input.conversationId && plan.mime_type === "text/markdown") {
        const maxPlanChars = Math.min(MAX_PLAN_CHARS, Math.floor(inputTokenBudget * 1.5));
        instructionContext.push({
          kind: "active_plan_artifact",
          documentId: plan.id,
          revisionId: String(plan.updated_at),
          body: (plan.content_md ?? "").slice(0, maxPlanChars),
        });
      }
    } catch (error) {
      logger.error({ err: error }, "failed to load active plan");
    }
  }

  const modelReadyRecent = await transformUserFilePartsForModel(recent, input.userId, input.supportsImageInput);
  const converted = await convertToModelMessages(modelReadyRecent, {
    convertDataPart: (part) => {
      if (part.type === "data-plan-execution") {
        return { type: "text", text: `<referenced_plan>${JSON.stringify(part.data)}</referenced_plan>` };
      }
      return undefined;
    },
  });
  return {
    messages: pruneMessages({
      messages: converted,
      reasoning: "before-last-message",
      toolCalls: "before-last-2-messages",
      emptyMessages: "remove",
    }),
    instructionContext,
  };
}
