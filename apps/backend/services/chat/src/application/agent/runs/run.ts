import { randomBytes } from "node:crypto";

import type { BotProfileSnapshot } from "@backend/agent-runtime-ts/instructions/index";
import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  validateUIMessages,
} from "ai";

import type { AuthContext } from "../../../api/http/middleware/auth.js";
import type { AgentSkillRef, ProviderSnapshot } from "../../../infrastructure/clients/admin.js";
import { getProvider, getProviderLimits, getSkillBody, getSkillFile } from "../../../infrastructure/clients/admin.js";
import { canvasClient } from "../../../infrastructure/clients/canvas.js";
import { getDocument } from "../../../infrastructure/clients/knowledge.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import type { PersistedMessageContent } from "../../../infrastructure/persistence/schema.js";
import {
  getConversationRow,
  listMessages,
  setConversationTitle,
  updateConversationProvider,
  type Message,
} from "../../conversations.js";
import { NotFoundError, RequestError } from "../../errors.js";
import { createAgent } from "../agents/factory.js";
import { chatDataSchemas, chatMessageMetadataSchema } from "../chat-ui-schema.js";
import { shouldResetStoredResponseLineage } from "../context/budget.js";
import type { ContextCategoryId } from "../context/context-snapshot.js";
import {
  activatedSkillNameFromParts,
  attachedImageDocumentIdsFromParts,
  hasUntrustedFilePart,
  referencedDocumentIdsFromParts,
} from "../context/file-parts.js";
import { loadInstructionContext } from "../context/instruction-loader.js";
import { projectModelContext } from "../context/projector.js";
import { extractMemoryCandidates } from "../memory/extractor.js";
import {
  addUsage,
  EMPTY_USAGE,
  extractUsageTokens,
  failAgentRun,
  type UsageTokens,
} from "../observability/lifecycle.js";
import { createPublishedAgentPartStream } from "../streams/native-parts.js";
import {
  AgentStreamCapacityError,
  activateAgentStream,
  consumeAgentSseStream,
  createAgentReplayResponse,
  deactivateAgentStream,
} from "../streams/service.js";
import { generateConversationTitle } from "../title/generator.js";
import { finalizeCancelledParts } from "./cancellation.js";
import {
  compactHistoricalSkillOutputs,
  continuedSkillReference,
  type ContinuedSkillReference,
} from "./continuation.js";
import { abortRun, registerRunController, releaseRun } from "./lease.js";
import {
  claimAgentRunOperation,
  finalizeAgentRunJournal,
  getAgentRunById,
  getLatestResponseLineage,
  getLatestConversationContextRecord,
  getRunTrace,
  isRunActive,
  type AgentRunOperation,
  type AgentRunTrace,
} from "./repository.js";
import { terminalStreamError } from "./stream-outcome.js";

export interface RunAgentInput {
  imageProvider?: ProviderSnapshot | null;
  videoProviderId?: string | null;
  botProfile?: BotProfileSnapshot | null;
  /** Bot-bound skills (L1) advertised to the model via `<available_skills>`. */
  botSkills?: AgentSkillRef[];
  /** Per-run behavior selector carried in the run request body (ADR-0035);
   *  ephemeral, never persisted. Defaults to normal. */
  mode?: "normal" | "plan";
  agentId?: string | null;
  trigger: "submit-message" | "regenerate-message";
  messageId?: string;
  expectedRevision: number;
  requestId: string;
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
  historyRevision: number;
}

const DEFAULT_CONVERSATION_TITLE = "新对话";

function isAutoNamableTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed === "" || trimmed === DEFAULT_CONVERSATION_TITLE;
}

function describeStreamError(error: unknown): string {
  if (error instanceof AgentStreamCapacityError) {
    return "响应流超过可恢复容量限制，已安全终止。";
  }
  if (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError")
  ) {
    return "已取消。";
  }
  return "模型调用失败，请稍后重试。";
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

function requestedOperation(input: RunAgentInput, latestMessage: AnyUIMessage): AgentRunOperation {
  if (input.trigger === "regenerate-message") {
    if (!input.messageId) throw new RequestError("regeneration requires a target message id");
    return "regenerate-message";
  }
  if (latestMessage.role === "assistant") {
    if (!input.messageId || input.messageId !== latestMessage.id) {
      throw new RequestError("tool continuation must identify its assistant message");
    }
    return "tool-continuation";
  }
  return input.messageId ? "edit-message" : "submit-message";
}

function assertUserSubmissionParts(message: AnyUIMessage): void {
  if (message.metadata !== undefined) {
    throw new RequestError("user messages cannot submit authoritative metadata");
  }
  for (const part of message.parts) {
    if (
      part.type !== "text" &&
      part.type !== "file" &&
      part.type !== "data-plan-execution" &&
      part.type !== "data-skill-activation"
    ) {
      throw new RequestError(`user messages cannot submit ${part.type} parts`);
    }
  }
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

export function persistedMessagesToModelUiMessages(messages: Message[]): AnyUIMessage[] {
  return messages
    .filter((message) => message.role !== "assistant" || message.status === "ok")
    .map(persistedMessageToUiMessage);
}

export function removeStoredResponseReferences(messages: AnyUIMessage[]): AnyUIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part): AnyUIMessage["parts"] => {
      if (part.type === "custom" && part.kind === "openai.compaction") {
        return [];
      }
      if (!("providerMetadata" in part)) {
        return [part];
      }
      const { providerMetadata: _providerMetadata, ...rest } = part;
      return [rest];
    }),
  }));
}

export function isStoredResponseLineageCurrent(messages: AnyUIMessage[], outputMessageId: string): boolean {
  const predecessor = messages.at(-1)?.role === "user" ? messages.at(-2) : messages.at(-1);
  return predecessor?.id === outputMessageId;
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
  if (conversation.canvasId && conversation.projectId) {
    await canvasClient().graph(auth, conversation.projectId, conversation.canvasId);
  }
  const uiMessages = await validateUIMessages<AnyUIMessage>({
    messages: uiMessagesInput,
    metadataSchema: chatMessageMetadataSchema.optional(),
    dataSchemas: chatDataSchemas,
  });
  const latestMessage = uiMessages.at(-1);
  if (!latestMessage) {
    throw new RequestError("agent prompt is required");
  }
  if (latestMessage.role !== "user" && latestMessage.role !== "assistant") {
    throw new RequestError("the last chat message must be a user message or completed client tool call");
  }
  const operation = requestedOperation(input, latestMessage);
  if ((operation === "submit-message" || operation === "edit-message") && latestMessage.role !== "user") {
    throw new RequestError("this operation requires a user message");
  }
  if (operation === "tool-continuation" && latestMessage.role !== "assistant") {
    throw new RequestError("tool continuation requires an assistant message");
  }
  const submittedUser = operation === "submit-message" || operation === "edit-message" ? latestMessage : null;
  if (submittedUser) assertUserSubmissionParts(submittedUser);
  if (submittedUser && hasUntrustedFilePart(submittedUser.parts)) {
    throw new RequestError("file attachments must reference a conversation document");
  }
  const requestedDocumentIds = submittedUser ? [...new Set(referencedDocumentIds(submittedUser))] : [];
  if (submittedUser) {
    const prompt = textFromUiMessage(submittedUser);
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

  if (submittedUser && (!submittedUser.id || submittedUser.id.length > 32)) {
    throw new RequestError("user message id must contain 1 to 32 characters");
  }
  const claimedUserMessage = submittedUser;
  const claim = await claimAgentRunOperation({
    conversationId: conversation.id,
    userId: conversation.userId,
    providerId: provider.id,
    model: provider.model,
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    operation,
    targetMessageId: input.messageId ?? null,
    requestContext: { agentId: input.agentId ?? null, mode: input.mode ?? "normal" },
    ...(operation === "tool-continuation" ? { continuationMessage: latestMessage } : {}),
    ...(claimedUserMessage
      ? {
          inputMessage: {
            id: claimedUserMessage.id,
            role: "user" as const,
            content: serializeMessageContent(claimedUserMessage),
          },
        }
      : {}),
  });
  if (claim.duplicate) {
    return createAgentReplayResponse(conversation.id, claim.runId, { isRunLive: isRunActive });
  }
  const runId = claim.runId;
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
      listMessages(conversation.id, claim.historyMessageId),
      loadInstructionContext({
        userId: conversation.userId,
        mode,
        botProfile: input.botProfile,
      }),
      updateConversationProvider(conversation.id, provider.id, provider.model),
    ]);

    const firstPersistedUser = persistedMessages.find((message) => message.role === "user");
    const titleSourceText = firstPersistedUser
      ? textFromUiMessage(persistedMessageToUiMessage(firstPersistedUser))
      : "";
    const shouldGenerateTitle =
      (operation === "submit-message" || operation === "edit-message") &&
      isAutoNamableTitle(conversation.title) &&
      titleSourceText.length > 0;

    const modelUiMessages = persistedMessagesToModelUiMessages(persistedMessages);
    let continuedSkill: ContinuedSkillReference | null = null;
    if (operation === "tool-continuation") {
      const continuationIndex = modelUiMessages.findIndex(
        (message) => message.id === latestMessage.id && message.role === "assistant",
      );
      if (continuationIndex < 0) {
        throw new RequestError("client tool continuation message was not found");
      }
      const persistedContinuation = modelUiMessages[continuationIndex];
      continuedSkill = continuedSkillReference(persistedContinuation);
    }

    const latestUser = [...modelUiMessages].reverse().find((message) => message.role === "user");
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
      lineage !== null && isStoredResponseLineageCurrent(modelUiMessages, lineage.outputMessageId);
    const supportsStoredContinuation = provider.responsesDialect !== "deepseek_responses";
    const lineageNeedsCompaction = lineageIsCurrent && shouldResetStoredResponseLineage(lineage.inputTokens, provider);
    const continueStoredLineage = lineageIsCurrent && supportsStoredContinuation && !lineageNeedsCompaction;
    if (lineageNeedsCompaction) {
      logger.info(
        {
          conversationId: conversation.id,
          runId,
          providerId: provider.id,
          inputTokens: lineage.inputTokens,
        },
        "stored response lineage requires compaction or lacks reliable usage; rebuilding from the local journal",
      );
    }
    const projectionSource = continueStoredLineage ? [modelUiMessages.at(-1)!] : modelUiMessages;
    const replayingFullHistory = !continueStoredLineage;
    const projectionUiMessages = replayingFullHistory
      ? removeStoredResponseReferences(projectionSource.map(compactHistoricalSkillOutputs))
      : projectionSource.map(compactHistoricalSkillOutputs);
    const projected = await projectModelContext({
      runId,
      conversationId: conversation.id,
      userId: conversation.userId,
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      provider,
      abortSignal: runSignal,
      messages: await validateUIMessages<AnyUIMessage>({
        messages: projectionUiMessages,
        metadataSchema: chatMessageMetadataSchema.optional(),
        dataSchemas: chatDataSchemas,
      }),
      onCompactionUsage: (usage) => {
        contextUsage = addUsage(contextUsage, usage);
      },
    });
    const modelMessages = projected.messages;
    contextUsage = projected.compactionUsage;

    const botSkills = input.botSkills ?? [];

    const activatedSkillName = latestUser ? activatedSkillNameFromParts(latestUser.parts) : null;
    const currentSkillName = continuedSkill?.name ?? activatedSkillName;
    if (currentSkillName) {
      const picked = botSkills.find((skill) => skill.name === currentSkillName);
      if (!picked) {
        throw new RequestError(`skill "${currentSkillName}" is not available for this agent`);
      }
      const { body, files } = await getSkillBody(picked.id, auth.tenantId, auth.workspaceId);
      if (!body.trim()) {
        throw new RequestError(`skill "${picked.name}" has no content to load`);
      }
      instructionInput.activatedSkill = {
        name: picked.name,
        body: files.length ? `${body}\n\nAvailable skill files:\n${files.join("\n")}` : body,
      };
    }
    const assistantMessageId =
      operation === "tool-continuation" ? claim.historyMessageId : randomBytes(8).toString("hex");
    const agentInstance = await createAgent({
      projectId: conversation.projectId,
      canvasId: conversation.canvasId,
      workspaceRole: auth.workspaceRole,
      runId,
      userId: conversation.userId,
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      conversationId: conversation.id,
      mode,
      provider,
      imageProvider: input.imageProvider,
      videoProviderId: input.videoProviderId,
      modelMessages,
      previousResponseId: continueStoredLineage ? lineage.responseId : null,
      attachedImageDocumentIds: latestUser ? attachedImageDocumentIdsFromParts(latestUser.parts) : [],
      instructionInput,
      activeSkillName: instructionInput.activatedSkill?.name ?? null,
      botSkills,
      loadSkillBody: async (skillId: string) => {
        const skill = await getSkillBody(skillId, auth.tenantId, auth.workspaceId);
        return skill.files.length ? `${skill.body}\n\nAvailable skill files:\n${skill.files.join("\n")}` : skill.body;
      },
      loadSkillFile: (skillId: string, path: string) => getSkillFile(skillId, auth.tenantId, auth.workspaceId, path),
    });
    const agent = agentInstance.agent;
    disposeAgentResources = agentInstance.dispose;
    const result = await agent.stream({
      messages: modelMessages,
      abortSignal: runSignal,
      experimental_sandbox: agentInstance.sandbox,
    });
    logger.info(
      { conversationId: conversation.id, runId, setupMs: Math.round(performance.now() - startedAt) },
      "run accepted",
    );
    const agentParts = createPublishedAgentPartStream({
      modelStream: result.stream,
      tools: agent.tools,
      originalMessages: modelUiMessages,
      assistantMessageId,
      publicationContext: {
        runId,
        conversationId: conversation.id,
        userId: conversation.userId,
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
        signal: runSignal,
        stageWorkspaceFile: (path, content, signal) => agentInstance.sandbox.stagePublishedFile(path, content, signal),
      },
      onError: (error) => {
        logger.error({ err: error }, "stream failed");
        return describeStreamError(error);
      },
    });

    const uiStream = createUIMessageStream<AnyUIMessage>({
      originalMessages: modelUiMessages,
      generateId: () => assistantMessageId,
      execute: async ({ writer }) => {
        const initialLineage = agentInstance.responseLineage();
        writer.write({
          type: "start",
          messageId: assistantMessageId,
          messageMetadata: {
            runId,
            providerId: provider.id,
            model: provider.model,
            responseId: initialLineage.responseId,
            parentResponseId: initialLineage.parentResponseId,
            status: "streaming",
            historyRevision: claim.historyRevision,
          } satisfies ChatMessageMetadata,
        });
        const titlePromise = shouldGenerateTitle
          ? (async () => {
              const title = await generateConversationTitle({ provider, userText: titleSourceText });
              if (!title) return;
              await setConversationTitle(conversation.id, title);
              writer.write({ type: "data-conversation-title", data: { title }, transient: true });
            })().catch((error) => logger.error({ err: error }, "conversation title update failed (non-fatal)"))
          : Promise.resolve();
        writer.merge(agentParts.stream);
        const end = await agentParts.end;
        await titlePromise;
        const currentRun = await getAgentRunById(runId).catch(() => null);
        const capacityError = runSignal.reason instanceof AgentStreamCapacityError ? runSignal.reason : null;
        const aborted =
          capacityError == null && (end.isAborted || runSignal.aborted || currentRun?.status === "cancel_requested");
        const streamError = capacityError ?? terminalStreamError(end.outcome, end.finishReason);
        const failed = streamError != null;
        const usage = await Promise.resolve(result.totalUsage).catch(() => null);
        const tokens = addUsage(extractUsageTokens(usage), contextUsage);
        const lineage = agentInstance.responseLineage();
        const metadata: ChatMessageMetadata = {
          runId,
          providerId: provider.id,
          model: provider.model,
          responseId: lineage.responseId,
          parentResponseId: lineage.parentResponseId,
          status: aborted ? "cancelled" : failed ? "failed" : "completed",
          finishReason: end.finishReason,
          usage: tokens,
          historyRevision: claim.historyRevision,
        };
        if (aborted) {
          writer.setOutcome({ status: "aborted" });
          writer.write({ type: "message-metadata", messageMetadata: metadata });
          return;
        }
        writer.setOutcome(failed ? { status: "failed", error: streamError } : { status: "completed" });
        writer.write({ type: "finish", finishReason: end.finishReason, messageMetadata: metadata });
      },
      onError: describeStreamError,
      onEnd: async ({ responseMessage, isContinuation, isAborted, finishReason, outcome }) => {
        const currentRun = await getAgentRunById(runId).catch(() => null);
        const capacityError = runSignal.reason instanceof AgentStreamCapacityError ? runSignal.reason : null;
        const aborted =
          capacityError == null && (isAborted || runSignal.aborted || currentRun?.status === "cancel_requested");
        const streamError = capacityError ?? terminalStreamError(outcome, finishReason);
        const failed = streamError != null;
        try {
          if (isContinuation !== (operation === "tool-continuation")) {
            throw new Error("SDK continuation identity does not match the claimed operation");
          }
          const parts = aborted ? finalizeCancelledParts(responseMessage.parts) : responseMessage.parts;
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
            historyRevision: claim.historyRevision,
          };
          // Sandbox disposal is the run finalizer boundary. It must finish (or
          // leave durable release responsibility for the reconciler) before the
          // journal becomes terminal and before the conversation lease is freed.
          try {
            await agentInstance.dispose();
          } finally {
            disposeAgentResources = null;
          }
          const finalized = await finalizeAgentRunJournal({
            runId,
            parts,
            aborted,
            message:
              parts.length > 0
                ? {
                    id: responseMessage.id,
                    content: serializeMessageContent({ ...responseMessage, parts, metadata } as AnyUIMessage),
                    status: aborted || failed ? "failed" : "ok",
                  }
                : null,
            status: aborted ? "cancelled" : failed ? "failed" : "completed",
            error: streamError ?? undefined,
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            cachedInputTokens: tokens.cachedInputTokens,
            reasoningTokens: tokens.reasoningTokens,
            totalTokens: tokens.totalTokens,
          });
          await releaseRun(runId);
          if (finalized.status === "completed") {
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
          throw error;
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: { "x-agent-run-id": runId },
      consumeSseStream: ({ stream }) => {
        const consumption = resumable
          ? consumeAgentSseStream(conversation.id, runId, stream, {
              onCapacityExceeded: (error) => {
                logger.error(
                  {
                    err: error,
                    runId,
                    capacityReason: error.reason,
                    replayBytes: error.bytes,
                    replayEntries: error.entries,
                  },
                  "agent replay stream capacity exceeded",
                );
                abortRun(runId, error);
              },
            })
          : consumeStream({ stream });
        void consumption.catch((error) => logger.error({ err: error }, "agent stream consumption failed"));
      },
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
  const contextWindow = await getProviderLimits(auth.tenantId, auth.workspaceId, businessRun.providerId)
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
  const limits = await getProviderLimits(auth.tenantId, auth.workspaceId, record.providerId).catch(() => null);
  const { snapshot } = record;
  return {
    context: {
      contextWindow: limits?.contextWindow ?? null,
      usedTokens: snapshot.usedTokens,
      categories: snapshot.categories,
    },
  };
}
