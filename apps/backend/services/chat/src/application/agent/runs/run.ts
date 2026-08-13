import { createHash, randomBytes } from "node:crypto";

import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from "ai";

import type { AuthContext } from "../../../api/http/middleware/auth.js";
import type { AgentSkillRef, ProviderSnapshot } from "../../../infrastructure/clients/admin.js";
import { getProvider, getProviderLimits, getSkillBody, getSkillFile } from "../../../infrastructure/clients/admin.js";
import { getDocument } from "../../../infrastructure/clients/knowledge.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import type { PersistedMessageContent } from "../../../infrastructure/persistence/schema.js";
import {
  createMessage,
  getConversationRow,
  listMessages,
  setConversationTitle,
  touchConversation,
  updateMessageContent,
  updateConversationProvider,
  type Message,
} from "../../conversations.js";
import { NotFoundError, RequestError } from "../../errors.js";
import { createAgent } from "../agents/factory.js";
import type { ContextCategoryId } from "../context/context-snapshot.js";
import {
  activatedSkillNameFromParts,
  attachedImageDocumentIdsFromParts,
  hasUntrustedFilePart,
  planExecutionPathFromParts,
  referencedDocumentIdsFromParts,
} from "../context/file-parts.js";
import { loadInstructionContext } from "../context/instruction-loader.js";
import type { BotProfileSnapshot } from "../context/instructions/index.js";
import { projectModelContext } from "../context/projector.js";
import { extractMemoryCandidates } from "../memory/extractor.js";
import {
  addUsage,
  EMPTY_USAGE,
  extractUsageTokens,
  failAgentRun,
  type UsageTokens,
} from "../observability/lifecycle.js";
import { activateAgentStream, consumeAgentSseStream, deactivateAgentStream } from "../streams/service.js";
import { generateConversationTitle } from "../title/generator.js";
import { isToolOutcome } from "../tools/outcome.js";
import { finalizeCancelledParts } from "./cancellation.js";
import {
  compactHistoricalSkillOutputs,
  continuedSkillReference,
  mergeClientContinuation,
  type ContinuedSkillReference,
} from "./continuation.js";
import { acquireRunLease, registerRunController, releaseRun } from "./lease.js";
import {
  createAgentRun,
  finishAgentRun,
  finalizeCancelledRunToolCalls,
  finalizeRunToolCallsFromParts,
  getAgentRunById,
  getLatestResponseLineage,
  getLatestConversationContextRecord,
  getRunTrace,
  type AgentRunTrace,
} from "./repository.js";

export interface RunAgentInput {
  imageProvider?: ProviderSnapshot | null;
  videoProviderId?: string | null;
  botProfile?: BotProfileSnapshot | null;
  /** Bot-bound skills (L1) advertised to the model via `<available_skills>`. */
  botSkills?: AgentSkillRef[];
  /** Per-run behavior selector carried in the run request body (ADR-0035);
   *  ephemeral, never persisted. Defaults to normal. */
  mode?: "normal" | "plan";
}

type AnyUIMessage = UIMessage<unknown, any, any>;

interface ChatMessageMetadata extends Record<string, unknown> {
  runId: string;
  providerId: string;
  model: string;
  responseId: string | null;
  parentResponseId: string | null;
  status: "streaming" | "completed" | "failed" | "cancelled";
  finishReason?: string;
  usage?: UsageTokens;
}

const DEFAULT_CONVERSATION_TITLE = "新对话";

function isAutoNamableTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed === "" || trimmed === DEFAULT_CONVERSATION_TITLE;
}

function persistedMessageId(id: string): string {
  return id.length <= 32 ? id : createHash("sha256").update(id).digest("hex").slice(0, 32);
}

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
  if (!trimmed) {
    return "模型调用失败，未返回具体原因。";
  }
  return `模型调用失败：${trimmed.slice(0, 600)}`;
}

function assertRunAccess(
  auth: AuthContext,
  conversationId: string,
  run: {
    conversationId: string;
    userId: string;
  },
): void {
  if (run.conversationId !== conversationId || run.userId !== auth.userId) {
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
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : undefined;
  return { version: 2, parts: message.parts, ...(metadata ? { metadata } : {}) };
}

function partsFromPersistedContent(content: PersistedMessageContent): AnyUIMessage["parts"] | null {
  if (content && typeof content === "object" && Array.isArray(content.parts)) {
    return content.parts as AnyUIMessage["parts"];
  }
  return null;
}

function persistedMessageToUiMessage(message: Message): AnyUIMessage {
  const parts = partsFromPersistedContent(message.content);
  return {
    id: message.id,
    role: message.role,
    parts: parts ?? [],
    ...(message.content.metadata ? { metadata: message.content.metadata } : {}),
  } as AnyUIMessage;
}

export async function createAgentRunResponse(
  auth: AuthContext,
  conversationId: string,
  provider: ProviderSnapshot & LanguageProviderSnapshot,
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
  if (!latestMessage) {
    throw new RequestError("agent prompt is required");
  }
  if (latestMessage.role !== "user" && latestMessage.role !== "assistant") {
    throw new RequestError("the last chat message must be a user message or completed client tool call");
  }
  const latestUser = [...uiMessages].reverse().find((message) => message.role === "user");
  if (latestUser && hasUntrustedFilePart(latestUser.parts)) {
    throw new RequestError("file attachments must reference a conversation document");
  }
  const requestedDocumentIds = latestUser ? [...new Set(referencedDocumentIds(latestUser))] : [];
  if (latestMessage.role === "user") {
    const prompt = latestUser ? textFromUiMessage(latestUser) : "";
    if (!prompt.trim() && !requestedDocumentIds.length) {
      throw new RequestError("agent prompt is required");
    }
  }

  await Promise.all(
    requestedDocumentIds.map(async (documentId) => {
      const document = await getDocument(conversation.userId, documentId);
      if (document.conversation_id !== conversation.id) {
        throw new RequestError(`document ${documentId} does not belong to this conversation`);
      }
    }),
  );

  const inputMessageId = latestMessage.role === "user" ? persistedMessageId(latestMessage.id) : null;
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

  let resumable = false;
  try {
    await activateAgentStream(conversation.id, runId);
    resumable = true;
  } catch (error) {
    logger.error({ err: error }, "failed to activate resumable stream");
  }

  let disposeAgentResources: (() => Promise<void>) | null = null;
  let contextUsage: UsageTokens = EMPTY_USAGE;
  try {
    const mode = input.mode === "plan" ? "plan" : "normal";
    const [persistedMessages, instructionInput] = await Promise.all([
      listMessages(conversation.id),
      loadInstructionContext({
        userId: conversation.userId,
        mode,
        botProfile: input.botProfile,
      }),
      updateConversationProvider(conversation.id, provider.id, provider.model),
    ]);

    const firstUserText = latestUser ? textFromUiMessage(latestUser) : "";
    const shouldGenerateTitle =
      latestMessage.role === "user" &&
      persistedMessages.length === 0 &&
      isAutoNamableTitle(conversation.title) &&
      firstUserText.length > 0;

    let modelUiMessages: AnyUIMessage[];
    let continuedSkill: ContinuedSkillReference | null = null;
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
      const historyMessages = persistedMessages.map(persistedMessageToUiMessage);
      const continuationIndex = historyMessages.findIndex(
        (message) => message.id === latestMessage.id && message.role === "assistant",
      );
      if (continuationIndex < 0) {
        throw new RequestError("client tool continuation message was not found");
      }
      const persistedContinuation = historyMessages[continuationIndex];
      continuedSkill = continuedSkillReference(persistedContinuation);
      const mergedMessage = mergeClientContinuation(persistedContinuation, latestMessage);
      await updateMessageContent({
        id: mergedMessage.id,
        conversationId: conversation.id,
        content: serializeMessageContent(mergedMessage),
        status: "ok",
      });
      modelUiMessages = [...historyMessages];
      modelUiMessages[continuationIndex] = mergedMessage;
    }

    const memorySourceUser = latestUser ?? [...modelUiMessages].reverse().find((message) => message.role === "user");
    const memorySourceText = memorySourceUser ? textFromUiMessage(memorySourceUser) : "";

    const runSignal = registerRunController(runId);
    const lineage = await getLatestResponseLineage({
      runId,
      conversationId: conversation.id,
      providerId: provider.id,
      model: provider.model,
    });
    const lineageIsCurrent =
      lineage != null && modelUiMessages.some((message) => message.id === lineage.outputMessageId);
    const projectionSource = lineageIsCurrent ? [modelUiMessages.at(-1)!] : modelUiMessages;
    const projectionUiMessages = projectionSource.map(compactHistoricalSkillOutputs);
    const projected = await projectModelContext({
      runId,
      conversationId: conversation.id,
      userId: conversation.userId,
      provider,
      abortSignal: runSignal,
      messages: await validateUIMessages<AnyUIMessage>({ messages: projectionUiMessages }),
    });
    const modelMessages = projected.messages;
    contextUsage = projected.compactionUsage;

    const botSkills = input.botSkills ?? [];

    const activatedSkillName = latestUser ? activatedSkillNameFromParts(latestUser.parts) : null;
    const executionPlanDocumentId = latestUser ? planExecutionPathFromParts(latestUser.parts) : null;
    const currentSkillName = continuedSkill?.name ?? activatedSkillName;
    if (currentSkillName) {
      const picked = botSkills.find((skill) => skill.name === currentSkillName);
      if (!picked) {
        throw new RequestError(`skill "${currentSkillName}" is not available for this agent`);
      }
      const { body, files } = await getSkillBody(picked.id, auth.orgId);
      if (!body.trim()) {
        throw new RequestError(`skill "${picked.name}" has no content to load`);
      }
      instructionInput.activatedSkill = {
        name: picked.name,
        body: files.length ? `${body}\n\nAvailable skill files:\n${files.join("\n")}` : body,
      };
    }
    const assistantMessageId = randomBytes(8).toString("hex");
    const agentInstance = await createAgent({
      runId,
      userId: conversation.userId,
      orgId: auth.orgId,
      conversationId: conversation.id,
      mode,
      provider,
      imageProvider: input.imageProvider,
      videoProviderId: input.videoProviderId,
      modelMessages,
      previousResponseId: lineageIsCurrent ? lineage.responseId : null,
      attachedImageDocumentIds: latestUser ? attachedImageDocumentIdsFromParts(latestUser.parts) : [],
      executionPlanDocumentId,
      instructionInput,
      activeSkillName: instructionInput.activatedSkill?.name ?? null,
      botSkills,
      loadSkillBody: async (skillId: string) => {
        const skill = await getSkillBody(skillId, auth.orgId);
        return skill.files.length ? `${skill.body}\n\nAvailable skill files:\n${skill.files.join("\n")}` : skill.body;
      },
      loadSkillFile: (skillId: string, path: string) => getSkillFile(skillId, auth.orgId, path),
    });
    const agent = agentInstance.agent;
    disposeAgentResources = agentInstance.dispose;
    const result = await agent.stream({ messages: modelMessages, abortSignal: runSignal });
    logger.info(
      { conversationId: conversation.id, runId, setupMs: Math.round(performance.now() - startedAt) },
      "run accepted",
    );
    let streamFailure: unknown = null;
    const agentUiStream = toUIMessageStream({
      stream: result.stream,
      tools: agent.tools,
      originalMessages: modelUiMessages,
      generateMessageId: () => assistantMessageId,
      sendSources: true,
      messageMetadata: ({ part }): ChatMessageMetadata | undefined => {
        const lineage = agentInstance.responseLineage();
        const base = {
          runId,
          providerId: provider.id,
          model: provider.model,
          responseId: lineage.responseId,
          parentResponseId: lineage.parentResponseId,
        };
        if (part.type === "start") {
          return { ...base, status: "streaming" };
        }
        if (part.type === "finish") {
          return {
            ...base,
            status: part.finishReason === "error" ? "failed" : "completed",
            finishReason: part.finishReason,
            usage: extractUsageTokens(part.totalUsage),
          };
        }
        return undefined;
      },
      onError: (error) => {
        streamFailure = error;
        logger.error({ err: error }, "stream failed");
        return describeStreamError(error);
      },
      onEnd: async ({ responseMessage, isContinuation, isAborted, finishReason }) => {
        const currentRun = await getAgentRunById(runId).catch(() => null);
        const aborted = isAborted || runSignal.aborted || currentRun?.status === "cancel_requested";
        const failed = streamFailure != null || finishReason === "error";
        try {
          const sanitizedParts = sanitizePersistedParts(responseMessage.parts);
          const parts = aborted ? finalizeCancelledParts(sanitizedParts) : sanitizedParts;
          const lineage = agentInstance.responseLineage();
          const usage = await Promise.resolve(result.totalUsage).catch(() => null);
          const tokens = addUsage(extractUsageTokens(usage), contextUsage);
          const metadata: ChatMessageMetadata = {
            runId,
            providerId: provider.id,
            model: provider.model,
            responseId: lineage.responseId,
            parentResponseId: lineage.parentResponseId,
            status: aborted ? "cancelled" : failed ? "failed" : "completed",
            finishReason,
            usage: tokens,
          };
          let outputMessageId: string | null = null;
          if (parts.length > 0) {
            const content = serializeMessageContent({ ...responseMessage, parts, metadata } as AnyUIMessage);
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
          if (aborted) {
            await finalizeCancelledRunToolCalls(runId);
          } else {
            await finalizeRunToolCallsFromParts(runId, parts);
          }
          await finishAgentRun({
            runId,
            status: aborted ? "cancelled" : failed ? "failed" : "completed",
            error: failed ? (streamFailure ?? "model stream ended with an error") : undefined,
            outputMessageId,
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            cachedInputTokens: tokens.cachedInputTokens,
            reasoningTokens: tokens.reasoningTokens,
            totalTokens: tokens.totalTokens,
          });
          await touchConversation(conversation.id);
          await releaseRun(runId);
          if (!aborted && !failed) {
            void extractMemoryCandidates({
              userId: conversation.userId,
              runId,
              provider,
              userText: memorySourceText,
            }).catch((error) => logger.error({ err: error }, "memory extraction failed (non-fatal)"));
          }
        } catch (error) {
          logger.error({ err: error }, "stream completion persistence failed");
          await failAgentRun({ runId, error }).catch((finishError) =>
            logger.error({ err: finishError }, "failed to mark run failed"),
          );
          await releaseRun(runId).catch(() => undefined);
        } finally {
          await agentInstance.dispose();
          disposeAgentResources = null;
        }
      },
    });
    const uiStream = shouldGenerateTitle
      ? createUIMessageStream<AnyUIMessage>({
          execute: async ({ writer }) => {
            const titlePromise = (async () => {
              const title = await generateConversationTitle({
                provider,
                userText: firstUserText,
              });
              if (!title) {
                return;
              }
              await setConversationTitle(conversation.id, title);
              writer.write({
                type: "data-conversation-title",
                data: { title },
                transient: true,
              });
            })().catch((error) => logger.error({ err: error }, "conversation title update failed (non-fatal)"));
            writer.merge(agentUiStream);
            await titlePromise;
          },
          onError: describeStreamError,
        })
      : agentUiStream;

    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: { "x-agent-run-id": runId },
      consumeSseStream: resumable
        ? ({ stream }) => {
            void consumeAgentSseStream(conversation.id, runId, stream).catch((error) =>
              logger.error({ err: error }, "resumable stream consumption failed"),
            );
          }
        : undefined,
    });
  } catch (error) {
    await disposeAgentResources?.();
    if (resumable) {
      await deactivateAgentStream(conversation.id, runId).catch((streamError) =>
        logger.error({ err: streamError }, "failed to clear resumable stream"),
      );
    }
    await failAgentRun({ runId, error, usage: contextUsage });
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
  if (!businessRun) {
    throw new NotFoundError("agent run not found");
  }
  assertRunAccess(auth, conversationId, businessRun);
  const trace = await getRunTrace(businessRun.id);
  if (!trace) {
    throw new NotFoundError("agent run trace not found");
  }
  const contextWindow = await getProviderLimits(auth.orgId, businessRun.providerId)
    .then((limits) => limits.contextWindow)
    .catch(() => null);
  return { ...trace, contextWindow };
}

export interface ConversationContextView {
  contextWindow: number | null;
  usedTokens: number;
  categories: Array<{
    id: ContextCategoryId;
    tokens: number;
  }>;
}

export async function getConversationContext(
  auth: AuthContext,
  conversationId: string,
): Promise<{ context: ConversationContextView | null }> {
  await getConversationRow(auth, conversationId);
  const record = await getLatestConversationContextRecord(conversationId);
  if (!record) {
    return { context: null };
  }
  const limits = await getProviderLimits(auth.orgId, record.providerId).catch(() => null);
  const { snapshot } = record;
  return {
    context: {
      contextWindow: limits?.contextWindow ?? null,
      usedTokens: snapshot.usedTokens,
      categories: snapshot.categories,
    },
  };
}

function sanitizePersistedParts(parts: AnyUIMessage["parts"]): AnyUIMessage["parts"] {
  return parts.map(sanitizePersistedPart);
}

function sanitizePersistedPart(part: AnyUIMessage["parts"][number]): AnyUIMessage["parts"][number] {
  if (part.type === "tool-web_search" && "output" in part && part.output) {
    return {
      ...part,
      output: compactWebSearchOutput(part.output),
    } as AnyUIMessage["parts"][number];
  }

  if (part.type === "tool-knowledge_search" && "output" in part && part.output) {
    return {
      ...part,
      output: compactWebSearchOutput(part.output),
    } as AnyUIMessage["parts"][number];
  }

  return part;
}

function compactWebSearchOutput(output: unknown): unknown {
  if (!isToolOutcome(output) || (output.status !== "completed" && output.status !== "partial")) {
    return output;
  }
  if (!output.data || typeof output.data !== "object") {
    return output;
  }
  const row = output.data as Record<string, unknown>;
  const results = Array.isArray(row.results)
    ? row.results.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }
        const result = item as Record<string, unknown>;
        return {
          ...result,
          snippet: truncateString(result.snippet, 700),
          content: truncateString(result.content, 700),
          raw_content: truncateString(result.raw_content, 700),
        };
      })
    : row.results;
  return { ...output, data: { ...row, results } };
}

function truncateString(value: unknown, maxLength: number): unknown {
  if (typeof value !== "string" || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trimEnd()}...[truncated ${value.length} chars]`;
}
