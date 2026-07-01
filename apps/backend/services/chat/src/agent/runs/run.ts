import { createHash, randomBytes } from "node:crypto";

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from "ai";

import type { ProviderSnapshot } from "../../clients/admin.js";
import { getDocument } from "../../clients/knowledge.js";
import type { PersistedMessageContent } from "../../db/schema.js";
import { NotFoundError, RequestError } from "../../lib/errors.js";
import type { AuthContext } from "../../middleware/auth.js";
import {
  createMessage,
  getConversationRow,
  listMessages,
  setConversationTitle,
  touchConversation,
  updateMessageContent,
  updateConversationProvider,
  type Message,
} from "../../services/conversations.js";
import { generateConversationTitle } from "../title/generator.js";
import {
  createAgentRun,
  finishAgentRun,
  getAgentRunById,
  getRunTrace,
  type AgentRunTrace,
} from "./repository.js";
import { createAgent } from "../agents/factory.js";
import { extractMemoryCandidates } from "../memory/extractor.js";
import { failAgentRun } from "../observability/lifecycle.js";
import {
  hasUntrustedFilePart,
  referencedDocumentIdsFromParts,
} from "../context/file-parts.js";
import { projectModelContext } from "../context/projector.js";
import { buildAgentInstructions } from "../context/instructions.js";
import { acquireRunLease, registerRunController, releaseRun } from "./lease.js";
import {
  activateAgentStream,
  consumeAgentSseStream,
  deactivateAgentStream,
} from "../streams/service.js";

export interface RunAgentInput {
  providerId?: string | null;
  multimodalProviderId?: string | null;
  documentIds?: string[];
  thinking?: boolean | null;
  reasoningEffort?: "low" | "medium" | "high" | null;
}

type AnyUIMessage = UIMessage<unknown, any, any>;

// The placeholder title createConversation() stamps on a new conversation. Only
// an auto-named (or blank) conversation is eligible for title generation, so a
// title the user typed themselves is never overwritten.
const DEFAULT_CONVERSATION_TITLE = "新对话";

function isAutoNamableTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed === "" || trimmed === DEFAULT_CONVERSATION_TITLE;
}

function persistedMessageId(id: string): string {
  return id.length <= 32 ? id : createHash("sha256").update(id).digest("hex").slice(0, 32);
}

// The reason a tool/stream failed must reach both the model (next turn, via
// convertToModelMessages) and the user. The AI SDK routes every thrown tool
// error and stream error through this string, so we surface the real cause
// instead of a generic placeholder. Aborts stay quiet; nothing else is hidden.
function describeStreamError(error: unknown): string {
  if (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError")
  ) {
    return "已取消。";
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
  const trimmed = message.trim();
  if (!trimmed) return "工具调用失败，未返回具体原因。";
  return `工具调用失败：${trimmed.slice(0, 600)}`;
}

function assertRunAccess(
  auth: AuthContext,
  conversationId: string,
  run: {
    conversationId: string;
    userId: string;
  },
): void {
  if (
    run.conversationId !== conversationId ||
    (!auth.isAdmin && run.userId !== auth.userId)
  ) {
    throw new NotFoundError("agent run not found");
  }
}

function textFromUiMessage(message: AnyUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function referencedDocumentIds(message: AnyUIMessage): string[] {
  return referencedDocumentIdsFromParts(message.parts);
}

function serializeMessageContent(message: AnyUIMessage): PersistedMessageContent {
  return { version: 1, parts: message.parts };
}

function partsFromPersistedContent(
  content: PersistedMessageContent,
): AnyUIMessage["parts"] | null {
  if (content && typeof content === "object" && Array.isArray(content.parts)) {
    return content.parts as AnyUIMessage["parts"];
  }
  return null;
}

function sanitizeHistoryParts(message: AnyUIMessage): AnyUIMessage {
  const parts = message.parts.filter((part) => {
    if (!part || typeof part !== "object" || !("toolCallId" in part)) return true;
    const state = "state" in part ? part.state : "";
    return state === "output-available" || state === "output-error";
  });
  return { ...message, parts } as AnyUIMessage;
}

function persistedMessageToUiMessage(message: Message): AnyUIMessage {
  const parts = partsFromPersistedContent(message.content);
  return sanitizeHistoryParts({
    id: message.id,
    role: message.role,
    parts: parts ?? [],
  } as AnyUIMessage);
}

export async function createAgentRunResponse(
  auth: AuthContext,
  conversationId: string,
  provider: ProviderSnapshot,
  uiMessagesInput: unknown[],
  input: RunAgentInput,
): Promise<Response> {
  if ((provider.providerKind ?? "chat") !== "chat") {
    throw new RequestError("selected provider is not a chat model provider");
  }

  const startedAt = performance.now();
  const conversation = await getConversationRow(auth, conversationId);
  const uiMessages = await validateUIMessages<AnyUIMessage>({ messages: uiMessagesInput });
  const latestMessage = uiMessages.at(-1);
  if (!latestMessage) throw new RequestError("agent prompt is required");
  if (latestMessage.role !== "user" && latestMessage.role !== "assistant") {
    throw new RequestError("the last chat message must be a user message or completed client tool call");
  }
  // A user turn carries the prompt directly. An assistant continuation (a
  // completed client tool such as ask_user) carries no user text in this
  // single-message payload, so the prompt is recovered from history below.
  const latestUser = [...uiMessages].reverse().find((message) => message.role === "user");
  if (latestUser && hasUntrustedFilePart(latestUser.parts)) {
    throw new RequestError("file attachments must reference a conversation document");
  }
  const messageDocumentIds = latestUser ? referencedDocumentIds(latestUser) : [];
  const requestedDocumentIds = [...new Set([...(input.documentIds ?? []), ...messageDocumentIds])];
  if (latestMessage.role === "user") {
    const prompt = latestUser ? textFromUiMessage(latestUser) : "";
    if (!prompt.trim() && !requestedDocumentIds.length) {
      throw new RequestError("agent prompt is required");
    }
  }

  await Promise.all(requestedDocumentIds.map(async (documentId) => {
    const document = await getDocument(conversation.userId, documentId);
    if (document.conversation_id !== conversation.id) {
      throw new RequestError(`document ${documentId} does not belong to this conversation`);
    }
  }));

  const inputMessageId = latestMessage.role === "user"
    ? persistedMessageId(latestMessage.id)
    : null;
  const runId = await createAgentRun({
    conversationId: conversation.id,
    userId: conversation.userId,
    providerId: provider.id,
    model: provider.model,
    inputMessageId,
  });
  try {
    await acquireRunLease(conversation.id, runId);
  } catch (error) {
    await finishAgentRun({ runId, status: "interrupted", error });
    throw error;
  }

  // Register before context/provider setup so a page refreshed before the POST
  // response headers arrive can already attach and wait for the first chunk.
  let resumable = false;
  try {
    await activateAgentStream(conversation.id, runId);
    resumable = true;
  } catch (error) {
    console.error("[chat-agent] failed to activate resumable stream", error);
  }

  let disposeAgentResources: (() => Promise<void>) | null = null;
  try {
    const [persistedMessages, instructions] = await Promise.all([
      listMessages(conversation.id),
      buildAgentInstructions({
        userId: conversation.userId,
        conversationId: conversation.id,
        documentIds: requestedDocumentIds,
        mode: conversation.agentMode === "plan" ? "plan" : "normal",
      }),
      updateConversationProvider(conversation.id, provider.id, provider.model),
    ]);

    // Auto-name the conversation from its opening user turn (industry standard:
    // the first message becomes the sidebar title). Gated to a brand-new,
    // still-auto-named conversation so we never clobber a user-set title or
    // re-run on every turn. The generation itself streams in below, off the
    // hot path.
    const firstUserText = latestUser ? textFromUiMessage(latestUser) : "";
    const shouldGenerateTitle =
      latestMessage.role === "user" &&
      persistedMessages.length === 0 &&
      isAutoNamableTitle(conversation.title) &&
      firstUserText.length > 0;

    let modelUiMessages: AnyUIMessage[];
    if (latestMessage.role === "user") {
      const storedMessageId = persistedMessageId(latestMessage.id);
      const alreadyPersisted = persistedMessages.some((message) => message.id === storedMessageId);
      await createMessage({
        id: storedMessageId,
        conversationId: conversation.id,
        role: "user",
        content: serializeMessageContent(latestMessage),
        status: "ok",
      });
      modelUiMessages = alreadyPersisted
        ? persistedMessages.map(persistedMessageToUiMessage)
        : [...persistedMessages.map(persistedMessageToUiMessage), { ...latestMessage, id: storedMessageId }];
    } else {
      // Client tools (for example ask_user) complete on the browser and trigger
      // a fresh ToolLoopAgent request. Persist that completed tool output and
      // use the validated UI message history as the continuation context.
      const historyMessages = persistedMessages.map(persistedMessageToUiMessage);
      const continuationIndex = historyMessages.findIndex(
        (message) => message.id === latestMessage.id && message.role === "assistant",
      );
      if (continuationIndex < 0) {
        throw new RequestError("client tool continuation message was not found");
      }
      await updateMessageContent({
        id: latestMessage.id,
        conversationId: conversation.id,
        content: serializeMessageContent(latestMessage),
        status: "ok",
      });
      modelUiMessages = [...historyMessages];
      modelUiMessages[continuationIndex] = latestMessage;
    }

    // Memory extraction needs the user's intent text. A user turn has it directly;
    // a client-tool continuation recovers it from the most recent user message in
    // the assembled context.
    const memorySourceUser =
      latestUser ?? [...modelUiMessages].reverse().find((message) => message.role === "user");
    const memorySourceText = memorySourceUser ? textFromUiMessage(memorySourceUser) : "";

    // Browser navigation only disconnects an SSE subscriber. Explicit Stop is
    // propagated through the run cancellation endpoint and this controller.
    const runSignal = registerRunController(runId);
    const mode = conversation.agentMode === "plan" ? "plan" : "normal";
    const projected = await projectModelContext({
      conversationId: conversation.id,
      userId: conversation.userId,
      mode,
      activePlanDocumentId: conversation.activePlanDocumentId,
      contextWindow: provider.contextWindow,
      maxOutputTokens: provider.maxOutputTokens,
      messages: await validateUIMessages<AnyUIMessage>({ messages: modelUiMessages }),
    });
    const modelMessages = projected.messages;
    const assistantMessageId = randomBytes(8).toString("hex");
    const agentInstance = await createAgent({
      runId,
      userId: conversation.userId,
      conversationId: conversation.id,
      mode,
      provider,
      multimodalProviderId: input.multimodalProviderId,
      modelMessages,
      instructions: [instructions, ...projected.instructionContext].join("\n\n"),
      reasoningEffort: input.reasoningEffort ?? (input.thinking ? "medium" : null),
    });
    const agent = agentInstance.agent;
    disposeAgentResources = agentInstance.dispose;
    const result = await agent.stream({ messages: modelMessages, abortSignal: runSignal });
    console.info("[chat-agent] run accepted", {
      conversationId: conversation.id,
      runId,
      setupMs: Math.round(performance.now() - startedAt),
    });
    const agentUiStream = toUIMessageStream({
      stream: result.stream,
      tools: agent.tools,
      originalMessages: modelUiMessages,
      generateMessageId: () => assistantMessageId,
      sendSources: true,
      onError: (error) => {
        console.error("[chat-agent] stream failed", error);
        return describeStreamError(error);
      },
      onEnd: async ({ responseMessage, isContinuation, isAborted, finishReason }) => {
        const currentRun = await getAgentRunById(runId).catch(() => null);
        const aborted =
          isAborted || runSignal.aborted || currentRun?.status === "cancel_requested";
        const failed = finishReason === "error";
        try {
          const sanitizedParts = sanitizePersistedParts(responseMessage.parts);
          const parts = sanitizedParts;
          let outputMessageId: string | null = null;
          if (parts.length > 0) {
            const content = serializeMessageContent({ ...responseMessage, parts } as AnyUIMessage);
            if (isContinuation) {
              await updateMessageContent({
                id: responseMessage.id,
                conversationId: conversation.id,
                content,
                status: aborted || failed ? "failed" : "ok",
              });
              outputMessageId = responseMessage.id;
            } else {
              const assistant = await createMessage({
                id: responseMessage.id,
                conversationId: conversation.id,
                role: "assistant",
                content,
                status: aborted || failed ? "failed" : "ok",
              });
              outputMessageId = assistant.id;
            }
          }
          const usage = await Promise.resolve(result.totalUsage).catch(() => null);
          await finishAgentRun({
            runId,
            status: aborted ? "cancelled" : failed ? "failed" : "completed",
            outputMessageId,
            totalTokens: usage?.totalTokens ?? null,
          });
          await touchConversation(conversation.id);
          await releaseRun(runId);
          if (!aborted && !failed) {
            void extractMemoryCandidates({
              userId: conversation.userId,
              runId,
              provider,
              userText: memorySourceText,
            }).catch((error) =>
              console.error("[chat-agent] memory extraction failed (non-fatal)", error),
            );
          }
        } catch (error) {
          console.error("[chat-agent] stream completion persistence failed", error);
          await failAgentRun({ runId, error }).catch((finishError) =>
            console.error("[chat-agent] failed to mark run failed", finishError),
          );
          await releaseRun(runId).catch(() => undefined);
        } finally {
          await agentInstance.dispose();
          disposeAgentResources = null;
        }
      },
    });
    // On a first turn, wrap the agent stream so a generated title rides the same
    // SSE channel as a transient `data-conversation-title` part: the client
    // updates the header + sidebar live (ChatGPT-style) without a refetch, and
    // because it is transient it is never persisted into the message. Title
    // generation runs concurrently with the agent — it never delays the first
    // token — and any failure is swallowed so the chat is unaffected.
    const uiStream = shouldGenerateTitle
      ? createUIMessageStream<AnyUIMessage>({
          execute: async ({ writer }) => {
            const titlePromise = (async () => {
              const title = await generateConversationTitle({
                provider,
                userText: firstUserText,
              });
              if (!title) return;
              await setConversationTitle(conversation.id, title);
              writer.write({
                type: "data-conversation-title",
                data: { title },
                transient: true,
              });
            })().catch((error) =>
              console.error("[chat-agent] conversation title update failed (non-fatal)", error),
            );
            writer.merge(agentUiStream);
            // Keep the stream open until the title write lands, so a very short
            // agent reply can't close the channel before the title arrives.
            await titlePromise;
          },
          onError: describeStreamError,
        })
      : agentUiStream;

    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: { "x-agent-run-id": runId },
      consumeSseStream: resumable
        ? ({ stream }) => consumeAgentSseStream(conversation.id, runId, stream)
        : undefined,
    });
  } catch (error) {
    await disposeAgentResources?.();
    if (resumable) {
      await deactivateAgentStream(conversation.id, runId).catch((streamError) =>
        console.error("[chat-agent] failed to clear resumable stream", streamError),
      );
    }
    await failAgentRun({ runId, error });
    await releaseRun(runId).catch(() => undefined);
    throw error;
  }
}

export async function getAgentRunTrace(
  auth: AuthContext,
  conversationId: string,
  runId: string,
): Promise<AgentRunTrace> {
  const businessRun = await getAgentRunById(runId);
  if (!businessRun) throw new NotFoundError("agent run not found");
  assertRunAccess(auth, conversationId, businessRun);
  const trace = await getRunTrace(businessRun.id);
  if (!trace) throw new NotFoundError("agent run trace not found");
  return trace;
}

function sanitizePersistedParts(parts: AnyUIMessage["parts"]): AnyUIMessage["parts"] {
  return parts.map(sanitizePersistedPart) as AnyUIMessage["parts"];
}

function sanitizePersistedPart(part: AnyUIMessage["parts"][number]): AnyUIMessage["parts"][number] {
  if (part.type === "reasoning" && part.text.length > 4_000) {
    return {
      ...part,
      text: `${part.text.slice(0, 4_000).trimEnd()}\n[persisted reasoning truncated: ${part.text.length} chars]`,
    };
  }

  if (part.type === "tool-web_search" && "output" in part && part.output) {
    return {
      ...part,
      output: compactWebSearchOutput(part.output),
    } as AnyUIMessage["parts"][number];
  }

  return part;
}

function compactWebSearchOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const row = output as Record<string, unknown>;
  const results = Array.isArray(row.results)
    ? row.results.map((item) => {
        if (!item || typeof item !== "object") return item;
        const result = item as Record<string, unknown>;
        return {
          ...result,
          snippet: truncateString(result.snippet, 700),
          content: truncateString(result.content, 700),
          raw_content: truncateString(result.raw_content, 700),
        };
      })
    : row.results;
  return { ...row, results };
}

function truncateString(value: unknown, maxLength: number): unknown {
  if (typeof value !== "string" || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...[truncated ${value.length} chars]`;
}
