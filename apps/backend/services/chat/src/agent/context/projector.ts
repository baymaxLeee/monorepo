import { convertToModelMessages, pruneMessages, type ModelMessage, type UIMessage } from "ai";
import { and, eq } from "drizzle-orm";

import { getDocument, getDocumentSource } from "../../clients/knowledge.js";
import { getDb } from "../../db/index.js";
import { conversationContexts } from "../../db/schema.js";
import { buildCompactionState, type CompactionState } from "./compaction-state.js";
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
    // Another run created the first snapshot. Its revision wins; the next run
    // will compact incrementally from that canonical state.
  }
}

async function transformUserFilePartsForModel(
  messages: AnyUIMessage[],
  userId: string,
): Promise<AnyUIMessage[]> {
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

  const imageFiles = new Map<string, { data: Uint8Array; filename: string; mediaType: string }>();
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
      console.error("[chat-context] failed to load image attachment", error);
    }
  }));

  return messages.map((message) => {
    if (message.role !== "user") return message;
    return {
      ...message,
      parts: message.parts.flatMap((part): AnyUIMessage["parts"] => {
        if (part.type !== "file") return [part];
        const docId = documentIdFromFilePart(part);
        if (!docId) return [part];
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
        return [{
          type: "text" as const,
          text: `<document_reference id="${docId}" filename="${String(part.filename ?? "")}" mime_type="${mediaType}" />`,
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
  messages: AnyUIMessage[];
}): Promise<{ messages: ModelMessage[]; instructionContext: string[] }> {
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

  // Incremental compaction: the stored snapshot already summarizes everything
  // up to coveredThroughMessageId. Only fold the messages that have sunk below
  // the recent-window since then, so a long conversation never re-summarizes
  // its whole history every turn.
  let summary = stored?.summary ?? "";
  if (older.length) {
    const coveredIndex = stored?.coveredThroughMessageId
      ? older.findIndex((message) => message.id === stored.coveredThroughMessageId)
      : -1;
    const newlyOlder = coveredIndex >= 0 ? older.slice(coveredIndex + 1) : older;
    if (newlyOlder.length) {
      const addition = compactOlderMessages(newlyOlder);
      // Reuse the stored summary as the base only when it actually covers part
      // of the current older window; otherwise fall back to a full recompaction.
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
        console.error("[chat-context] failed to persist snapshot", error),
      );
    }
  }

  const instructionContext: string[] = [];
  if (summary) {
    instructionContext.push(`<conversation_summary>\n${summary}\n</conversation_summary>`);
  }
  if (state) {
    const serializedState = JSON.stringify(state);
    instructionContext.push(
      `<conversation_state>\n${serializedState}\n</conversation_state>`,
    );
  }

  if (input.mode === "plan" && input.activePlanDocumentId) {
    try {
      const plan = await getDocument(input.userId, input.activePlanDocumentId);
      if (plan.conversation_id === input.conversationId && plan.mime_type === "text/markdown") {
        const maxPlanChars = Math.min(MAX_PLAN_CHARS, Math.floor(inputTokenBudget * 1.5));
        instructionContext.push(
          `<active_plan_artifact document_id="${plan.id}" revision_id="${plan.updated_at}">\n${(plan.content_md ?? "").slice(0, maxPlanChars)}\n</active_plan_artifact>`,
        );
      }
    } catch (error) {
      console.error("[chat-context] failed to load active plan", error);
    }
  }

  const modelReadyRecent = await transformUserFilePartsForModel(recent, input.userId);
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
