import { createHash, randomBytes } from "node:crypto";

import {
  RuntimeTurn,
  resolveContextWindow,
  shouldResetStoredResponseLineage,
  resolveTurnPluginSnapshot,
  type ApprovalPolicy,
  type BuiltInPermissionProfileId,
  type ContextCompactionEvent,
  type ModelRetryEvent,
  type SessionContextSnapshot,
} from "@repo/agent-runtime";
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  validateUIMessages,
} from "ai";

import { isArkStoredResponseReference, type ReasoningEffort } from "#runtime/provider-model";

import { getServerSettings } from "../../../config/server.js";
import {
  attachPlatformMcpCredential,
  bindTurnPluginGrants,
} from "../../../infrastructure/clients/plugin-capabilities.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import type { PersistedThreadItemContent } from "../../../infrastructure/persistence/schema.js";
import { NotFoundError, RequestError } from "../../errors.js";
import { getSessionAttachment } from "../../session-files.js";
import { getSessionRow, listMessages, type Message } from "../../sessions.js";
import { chatDataSchemas, chatMessageMetadataSchema, type ChatUIDataTypes } from "../chat-ui-schema.js";
import type { ContextCategoryId } from "../context/context-snapshot.js";
import { activatedSkillNameFromParts, sessionFileIdFromUrl } from "../context/file-parts.js";
import { loadInstructionContext } from "../context/instruction-loader.js";
import { CONTEXT_COMPACTOR_VERSION, projectModelContext } from "../context/model-context.js";
import {
  addUsage,
  EMPTY_USAGE,
  extractUsageTokens,
  failAgentRun,
  type UsageTokens,
} from "../observability/lifecycle.js";
import { prepareCloudTurn } from "../runtime/cloud-turn.js";
import type { RuntimeProviderCapability, TurnCapabilities } from "../runtime/types.js";
import { createPublishedAgentPartStream } from "../streams/native-parts.js";
import {
  AgentStreamCapacityError,
  activateAgentStream,
  consumeAgentSseStream,
  createAgentReplayResponse,
  deactivateAgentStream,
} from "../streams/service.js";
import { generateConversationTitlePart } from "../title/generator.js";
import type { ToolCatalog } from "../tools/catalog.js";
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
  persistCompletedStep,
  getAgentRunById,
  hasSessionContextCheckpoint,
  getLatestResponseLineage,
  getLatestSessionContextRecord,
  getRunTrace,
  isRunActive,
  persistAgentRunPluginSnapshot,
  persistTurnResumeEnvelope,
  readAgentRunPluginSnapshot,
  type AgentRunOperation,
  type AgentRunTrace,
  type ClaimedAgentRun,
  type OrphanedTurnRecovery,
  type RunLeaseToken,
  type TurnResumeEnvelope,
} from "./repository.js";
import { startAgentRunInputInbox } from "./steering.js";
import { terminalStreamError } from "./stream-outcome.js";

export interface RunAgentInput {
  reasoningEffort: ReasoningEffort;
  /** Frozen upper-host capabilities for exactly this admitted Turn. */
  capabilities: TurnCapabilities;
  trigger: "submit-message" | "regenerate-message";
  messageId?: string;
  expectedRevision: number;
  requestId: string;
  generateTitle?: boolean;
}

type AnyUIMessage = UIMessage<unknown, any, any>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function stableDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

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

function assertRunAccess(sessionId: string, run: { sessionId: string }): void {
  if (run.sessionId !== sessionId) {
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
    if (part.type !== "text" && part.type !== "file" && part.type !== "data-skill-activation") {
      throw new RequestError(`user messages cannot submit ${part.type} parts`);
    }
  }
}

function serializeMessageContent(message: AnyUIMessage): PersistedThreadItemContent {
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : undefined;
  return { version: 2, parts: message.parts, ...(metadata ? { metadata } : {}) };
}

function partsFromPersistedContent(content: PersistedThreadItemContent): AnyUIMessage["parts"] | null {
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

export function removeStoredResponseReferences(
  messages: AnyUIMessage[],
  isStoredReference: (part: AnyUIMessage["parts"][number]) => boolean,
): AnyUIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part): AnyUIMessage["parts"] => {
      if (isStoredReference(part)) {
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

export async function finalizeAfterAgentDisposal<T>(input: {
  dispose: () => Promise<void>;
  finalize: (disposalError: unknown | null) => Promise<T>;
}): Promise<{ finalized: T; disposalError: unknown | null }> {
  let disposalError: unknown | null = null;
  try {
    await input.dispose();
  } catch (error) {
    disposalError = error;
  }
  return { finalized: await input.finalize(disposalError), disposalError };
}

export async function createAgentRunResponse(
  sessionId: string,
  uiMessagesInput: unknown[],
  input: RunAgentInput,
  toolCatalog: ToolCatalog,
): Promise<Response> {
  const provider = input.capabilities.provider;
  if ((provider.providerKind ?? "chat") !== "chat") {
    throw new RequestError("selected provider is not a chat model provider");
  }

  const session = await getSessionRow(sessionId);
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
  if (submittedUser) {
    assertUserSubmissionParts(submittedUser);
    if (!submittedUser.id || submittedUser.id.length > 32)
      throw new RequestError("user message id must contain 1 to 32 characters");
    if (!textFromUiMessage(submittedUser) && !submittedUser.parts.some((part) => part.type === "file"))
      throw new RequestError("agent prompt is required");
    submittedUser.parts = await Promise.all(
      submittedUser.parts.map(async (part) => {
        if (part.type !== "file") return part;
        const fileId = sessionFileIdFromUrl(part.url, session.id);
        if (!fileId || part.providerReference != null) throw new RequestError("invalid session attachment reference");
        const file = await getSessionAttachment(session.id, fileId);
        return { type: "file" as const, url: part.url, filename: file.filename, mediaType: file.mime_type };
      }),
    );
  }
  const claimedUserMessage = submittedUser;
  const claim = await claimAgentRunOperation({
    sessionId: session.id,
    providerId: provider.id,
    model: provider.model,
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    operation,
    targetMessageId: input.messageId ?? null,
    requestContext: {
      reasoningEffort: input.reasoningEffort,
      capabilitiesDigest: stableDigest({
        provider: providerResumeBinding(provider),
        media: input.capabilities.media,
        plugins: input.capabilities.plugins,
        skills: input.capabilities.skills,
        memories: input.capabilities.memories,
      }),
    },
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
    return createAgentReplayResponse(session.id, claim.runId, { isRunLive: isRunActive });
  }
  return executeClaimedAgentRunResponse({
    session,
    provider,
    claim,
    operation,
    input,
    toolCatalog,
    approvalPolicy: session.approvalPolicy as ApprovalPolicy,
    permissionProfile: session.permissionProfile as BuiltInPermissionProfileId,
  });
}

interface ClaimedAgentRunExecution {
  session: Awaited<ReturnType<typeof getSessionRow>>;
  provider: RuntimeProviderCapability;
  claim: ClaimedAgentRun;
  operation: AgentRunOperation;
  input: RunAgentInput;
  toolCatalog: ToolCatalog;
  approvalPolicy: ApprovalPolicy;
  permissionProfile: BuiltInPermissionProfileId;
  resume?: {
    decision: "resume-next-step" | "regenerate-model";
    envelope: TurnResumeEnvelope;
    leafMessageId: string;
  };
}

async function executeClaimedAgentRunResponse(execution: ClaimedAgentRunExecution): Promise<Response> {
  const { session, provider, claim, operation, input, toolCatalog, approvalPolicy, permissionProfile, resume } =
    execution;
  const startedAt = performance.now();
  const runId = claim.runId;
  const leaseToken: RunLeaseToken = { runId, attemptEpoch: claim.attemptEpoch };
  let resumable = false;
  try {
    await activateAgentStream(session.id, runId);
    resumable = true;
  } catch (error) {
    logger.error({ err: error }, "failed to activate resumable stream");
  }

  const runSignal = registerRunController(leaseToken);
  const runtimeTurn = new RuntimeTurn(runSignal);
  let contextUsage: UsageTokens = EMPTY_USAGE;
  try {
    const [persistedMessages, instructionInput] = await Promise.all([
      listMessages(session.id, resume?.leafMessageId ?? claim.historyMessageId),
      loadInstructionContext(input.capabilities.memories),
    ]);

    if (resume) {
      const baseMessages =
        resume.leafMessageId === claim.historyMessageId
          ? persistedMessages
          : await listMessages(session.id, claim.historyMessageId);
      const baseDigest = stableDigest(persistedMessagesToModelUiMessages(baseMessages));
      if (baseDigest !== resume.envelope.historyDigest) {
        throw new Error("turn recovery history no longer matches its resume envelope");
      }
    }

    const firstPersistedUser = persistedMessages.find((message) => message.role === "user");
    const titleSourceText = firstPersistedUser
      ? textFromUiMessage(persistedMessageToUiMessage(firstPersistedUser))
      : "";
    const shouldGenerateTitle =
      input.generateTitle === true &&
      (operation === "submit-message" || operation === "edit-message") &&
      titleSourceText.length > 0;

    const modelUiMessages = persistedMessagesToModelUiMessages(persistedMessages);
    let persistedContinuation: AnyUIMessage | undefined;
    let continuedSkill: ContinuedSkillReference | null = null;
    if (operation === "tool-continuation") {
      const continuationIndex = modelUiMessages.findIndex(
        (message) => message.id === claim.historyMessageId && message.role === "assistant",
      );
      if (continuationIndex < 0) {
        throw new RequestError("client tool continuation message was not found");
      }
      persistedContinuation = modelUiMessages[continuationIndex];
      continuedSkill = continuedSkillReference(persistedContinuation);
    }

    const latestUser = [...modelUiMessages].reverse().find((message) => message.role === "user");

    const assistantMessageId =
      resume?.envelope.snapshot.execution.assistantMessageId ??
      (operation === "tool-continuation" ? claim.historyMessageId : randomBytes(8).toString("hex"));
    const pendingModelRetryEvents: ModelRetryEvent[] = [];
    let modelRetrySink: ((event: ModelRetryEvent) => void) | null = null;
    const publishModelRetry = (event: ModelRetryEvent) => {
      if (modelRetrySink) modelRetrySink(event);
      else pendingModelRetryEvents.push(event);
    };
    let contextCompacted = false;
    const pendingCompactionEvents: ContextCompactionEvent[] = [];
    let compactionSink: ((event: ContextCompactionEvent) => void) | null = null;
    const publishCompaction = (event: ContextCompactionEvent) => {
      if (event.state === "completed") contextCompacted = true;
      if (compactionSink) compactionSink(event);
      else pendingCompactionEvents.push(event);
    };
    const pendingContextUsageEvents: ChatUIDataTypes["context-usage"][] = [];
    let contextUsageSink: ((event: ChatUIDataTypes["context-usage"]) => void) | null = null;
    const publishContextUsage = (update: { snapshot: SessionContextSnapshot; estimated: boolean }) => {
      const event: ChatUIDataTypes["context-usage"] = {
        contextWindow: provider.contextWindow,
        autoCompactAt: resolveContextWindow(provider).compactAt,
        usedTokens: update.snapshot.usedTokens,
        estimated: update.estimated,
        compacted: contextCompacted,
        categories: update.snapshot.categories.map((category) => ({
          id: category.id === "session" ? "conversation" : category.id,
          tokens: category.tokens,
        })),
      };
      if (contextUsageSink) contextUsageSink(event);
      else pendingContextUsageEvents.push(event);
    };
    const turn = await runtimeTurn.start(async (scope) => {
      const inbox = startAgentRunInputInbox(leaseToken, runtimeTurn.input);
      scope.defer(() => inbox.close());
      const resolvedPlugins = await resolveTurnPluginSnapshot(
        await readAgentRunPluginSnapshot(leaseToken),
        input.capabilities.plugins.plugins.map(({ activation }) => activation),
        async () => input.capabilities.plugins,
      );
      const pluginSnapshot = bindTurnPluginGrants(
        attachPlatformMcpCredential(resolvedPlugins, getServerSettings()),
        leaseToken,
      );
      await persistAgentRunPluginSnapshot(leaseToken, pluginSnapshot);
      const lineage = await getLatestResponseLineage({
        runId,
        attemptEpoch: claim.attemptEpoch,
        sessionId: session.id,
        providerId: provider.id,
        model: provider.model,
      });
      const lineageIsCurrent =
        lineage !== null && isStoredResponseLineageCurrent(modelUiMessages, lineage.outputMessageId);
      const lineageNeedsCompaction =
        lineageIsCurrent && shouldResetStoredResponseLineage(lineage.inputTokens, provider);
      const continueStoredLineage = lineageIsCurrent && !lineageNeedsCompaction;
      if (lineageNeedsCompaction) {
        logger.info(
          {
            sessionId: session.id,
            runId,
            providerId: provider.id,
            inputTokens: lineage.inputTokens,
          },
          "stored response lineage requires compaction or lacks reliable usage; rebuilding from the local journal",
        );
      }
      const projectionUiMessages = removeStoredResponseReferences(
        modelUiMessages.map(compactHistoricalSkillOutputs),
        isArkStoredResponseReference,
      );
      const frozenSkills = input.capabilities.skills;
      const skills = frozenSkills.map(({ id, name, description }) => ({ id, name, description }));
      const skillById = new Map(frozenSkills.map((skill) => [skill.id, skill] as const));

      const activatedSkillName = latestUser ? activatedSkillNameFromParts(latestUser.parts) : null;
      const currentSkillName = continuedSkill?.name ?? activatedSkillName;
      const prepared = await prepareCloudTurn(
        {
          runId,
          attemptEpoch: claim.attemptEpoch,
          sessionId: session.id,
          signal: scope.signal,
          pluginSnapshot,
          continuation: persistedContinuation,
          provider,
          media: input.capabilities.media,
          reasoningEffort: input.reasoningEffort,
          approvalPolicy,
          permissionProfile,
          onCompactionUsage: (usage) => {
            contextUsage = addUsage(contextUsage, usage);
          },
          onCompaction: publishCompaction,
          onContextUsage: publishContextUsage,
          onModelRetry: publishModelRetry,
          previousResponseId: continueStoredLineage ? lineage.responseId : null,
          instructionInput,
          activeSkillName: currentSkillName,
          skills,
          loadSkillBody: async (skillId: string) => {
            const skill = skillById.get(skillId);
            if (!skill) throw new RequestError(`skill ${skillId} is not available in this Turn`);
            const files = Object.keys(skill.files).sort();
            return files.length ? `${skill.body}\n\nAvailable skill files:\n${files.join("\n")}` : skill.body;
          },
          loadSkillFile: async (skillId: string, path: string) => {
            const file = skillById.get(skillId)?.files[path];
            if (!file) throw new RequestError(`skill ${skillId} file ${path} is not available in this Turn`);
            return file;
          },
        },
        toolCatalog,
        scope,
      );
      const projected = await projectModelContext({
        owner: leaseToken,
        sessionId: session.id,
        provider,
        historyRevision: claim.historyRevision,
        historyDigest: stableDigest(modelUiMessages),
        instructionDigest: stableDigest(prepared.settings.instructions ?? null),
        toolCatalogDigest: prepared.host.catalogDigest,
        abortSignal: scope.signal,
        tools: prepared.settings.tools,
        remoteCompaction: prepared.settings.remoteCompaction,
        instructions: prepared.settings.instructions,
        previousInputTokens: lineageIsCurrent ? (lineage.inputTokens ?? undefined) : undefined,
        messages: await validateUIMessages<AnyUIMessage>({
          messages: projectionUiMessages,
          metadataSchema: chatMessageMetadataSchema.optional(),
          dataSchemas: chatDataSchemas,
        }),
        onCompactionUsage: (usage) => {
          contextUsage = addUsage(contextUsage, usage);
        },
        compactionRetry: prepared.settings.compactionRetry,
        onCompaction: publishCompaction,
        ...(resume
          ? {
              expectedGeneration: {
                instructionDigest: resume.envelope.instructionDigest,
                toolCatalogDigest: resume.envelope.toolCatalogDigest,
                workspaceDigest: resume.envelope.workspaceDigest,
                compactorVersion: resume.envelope.compactorVersion,
                remoteBinding: resume.envelope.remoteBinding,
              },
            }
          : {}),
      });
      if (resume) {
        if (resume.envelope.snapshot.execution.activeSkillName !== currentSkillName) {
          throw new Error("turn recovery active skill no longer matches its resume envelope");
        }
      } else {
        await persistTurnResumeEnvelope(leaseToken, {
          sessionId: session.id,
          historyMessageId: claim.historyMessageId,
          historyRevision: claim.historyRevision,
          historyDigest: projected.binding.historyDigest,
          instructionDigest: projected.binding.instructionDigest,
          toolCatalogDigest: projected.binding.toolCatalogDigest,
          workspaceDigest: projected.binding.workspaceDigest,
          compactorVersion: projected.binding.compactorVersion,
          remoteBinding: projected.binding.remoteBinding,
          snapshot: {
            schemaVersion: 2,
            execution: {
              operation,
              assistantMessageId,
              reasoningEffort: input.reasoningEffort,
              approvalPolicy,
              permissionProfile,
              pluginActivations: input.capabilities.plugins.plugins.map(({ activation }) => activation),
              skills,
              generateTitle: input.generateTitle === true,
              activeSkillName: currentSkillName,
              instructions: prepared.settings.instructions ?? null,
              providerBinding: {
                id: provider.id,
                model: provider.model,
                baseUrl: provider.baseUrl,
                extraBody: provider.extraBody,
                contextWindow: provider.contextWindow,
                maxOutputTokens: provider.maxOutputTokens,
                supportsImageInput: provider.supportsImageInput,
                providerKind: provider.providerKind,
              },
            },
          },
        });
      }
      if (projected.checkpointAdvanced) prepared.settings.onHistoryReplacement?.();
      contextCompacted = projected.compacted;
      contextUsage = projected.compactionUsage;

      return {
        ...prepared,
        settings: {
          ...prepared.settings,
          stepCheckpoint: { assistantId: assistantMessageId, save: projected.saveStepCheckpoint },
        },
        messages: projected.messages,
      };
    });
    const result = turn.result;
    logger.info({ sessionId: session.id, runId, setupMs: Math.round(performance.now() - startedAt) }, "run accepted");
    const agentParts = createPublishedAgentPartStream({
      modelStream: result.stream,
      tools: turn.tools,
      originalMessages: modelUiMessages,
      assistantMessageId,
      publicationContext: {
        runId,
        attemptEpoch: claim.attemptEpoch.toString(),
        sessionId: session.id,
        signal: runSignal,
        stageWorkspaceFile: (file, content, signal) => turn.host.sandbox.stagePublishedFile(file, content, signal),
      },
      onError: (error) => {
        logger.error({ err: error }, "stream failed");
        return describeStreamError(error);
      },
    });

    let stepJournalError: Error | undefined;
    const uiStream = createUIMessageStream<AnyUIMessage>({
      originalMessages: modelUiMessages,
      generateId: () => assistantMessageId,
      execute: async ({ writer }) => {
        const initialLineage = turn.host.responseLineage();
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
        modelRetrySink = (event) => writer.write({ type: "data-model-retry", data: event, transient: true });
        for (const event of pendingModelRetryEvents.splice(0)) modelRetrySink(event);
        compactionSink = (event) => writer.write({ type: "data-context-compaction", data: event, transient: true });
        for (const event of pendingCompactionEvents.splice(0)) compactionSink(event);
        contextUsageSink = (event) => writer.write({ type: "data-context-usage", data: event, transient: true });
        for (const event of pendingContextUsageEvents.splice(0)) contextUsageSink(event);
        const titlePromise = shouldGenerateTitle
          ? generateConversationTitlePart({ provider, userText: titleSourceText, signal: runSignal })
              .then((part) => {
                if (part) writer.write(part);
              })
              .catch((error) => logger.error({ err: error }, "conversation title stream failed (non-fatal)"))
          : Promise.resolve();
        writer.merge(agentParts.stream);
        const end = await agentParts.end;
        modelRetrySink = null;
        compactionSink = null;
        contextUsageSink = null;
        await titlePromise;
        const currentRun = await getAgentRunById(runId).catch(() => null);
        const capacityError = runSignal.reason instanceof AgentStreamCapacityError ? runSignal.reason : null;
        const aborted = capacityError == null && (runSignal.aborted || currentRun?.status === "cancel_requested");
        let streamError = stepJournalError ?? capacityError ?? terminalStreamError(end.outcome, end.finishReason);
        try {
          await runtimeTurn.dispose();
        } catch (error) {
          streamError ??= error instanceof Error ? error : new Error(String(error));
        }
        const failed = streamError != null;
        const usage = await Promise.resolve(result.totalUsage).catch(() => null);
        const tokens = addUsage(extractUsageTokens(usage), contextUsage);
        const lineage = turn.host.responseLineage();
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
      onStepEnd: async ({ responseMessage }) => {
        try {
          await persistCompletedStep(leaseToken, responseMessage.id, { version: 2, parts: responseMessage.parts });
        } catch (error) {
          stepJournalError = error instanceof Error ? error : new Error(String(error));
          runtimeTurn.cancel();
          throw stepJournalError;
        }
      },
      onEnd: async ({ responseMessage, isContinuation, finishReason, outcome }) => {
        const currentRun = await getAgentRunById(runId).catch(() => null);
        const capacityError = runSignal.reason instanceof AgentStreamCapacityError ? runSignal.reason : null;
        const aborted = capacityError == null && (runSignal.aborted || currentRun?.status === "cancel_requested");
        const streamError = stepJournalError ?? capacityError ?? terminalStreamError(outcome, finishReason);
        try {
          const expectsContinuation = operation === "tool-continuation" || resume?.decision === "resume-next-step";
          if (isContinuation !== expectsContinuation) {
            throw new Error("SDK continuation identity does not match the claimed operation");
          }
          const parts = aborted ? finalizeCancelledParts(responseMessage.parts) : responseMessage.parts;
          const lineage = turn.host.responseLineage();
          const usage = await Promise.resolve(result.totalUsage).catch(() => null);
          const tokens = addUsage(extractUsageTokens(usage), contextUsage);
          // Sandbox disposal is the run finalizer boundary. It must finish (or
          // leave durable release responsibility for the reconciler) before the
          // journal becomes terminal and before the session lease is freed.
          const settled = await finalizeAfterAgentDisposal({
            dispose: () => runtimeTurn.dispose(),
            finalize: async (disposalError) => {
              const terminalError = disposalError ?? streamError;
              const terminalStatus = aborted ? "cancelled" : terminalError ? "failed" : "completed";
              const metadata: ChatMessageMetadata = {
                runId,
                providerId: provider.id,
                model: provider.model,
                responseId: lineage.responseId,
                parentResponseId: lineage.parentResponseId,
                status: terminalStatus,
                finishReason,
                usage: tokens,
                historyRevision: claim.historyRevision,
              };
              return finalizeAgentRunJournal({
                runId,
                attemptEpoch: claim.attemptEpoch,
                parts,
                aborted,
                message:
                  parts.length > 0
                    ? {
                        id: responseMessage.id,
                        content: serializeMessageContent({ ...responseMessage, parts, metadata } as AnyUIMessage),
                        status: terminalStatus === "completed" ? "ok" : "failed",
                      }
                    : null,
                status: terminalStatus,
                error: terminalError ?? undefined,
                inputTokens: tokens.inputTokens,
                outputTokens: tokens.outputTokens,
                cachedInputTokens: tokens.cachedInputTokens,
                reasoningTokens: tokens.reasoningTokens,
                totalTokens: tokens.totalTokens,
              });
            },
          });
          const finalized = settled.finalized;
          await releaseRun(leaseToken);
          if (settled.disposalError) throw settled.disposalError;
        } catch (error) {
          logger.error({ err: error }, "stream completion persistence failed");
          await failAgentRun({ ...leaseToken, error }).catch((finishError) =>
            logger.error({ err: finishError }, "failed to mark run failed"),
          );
          await releaseRun(leaseToken).catch(() => undefined);
          throw error;
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: { "x-agent-run-id": runId },
      consumeSseStream: ({ stream }) => {
        const consumption = resumable
          ? consumeAgentSseStream(session.id, runId, stream, {
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
    const { finalized: failure } = await finalizeAfterAgentDisposal({
      dispose: () => runtimeTurn.dispose(),
      finalize: async (disposalError) => {
        if (resumable) {
          await deactivateAgentStream(session.id, runId).catch((err) =>
            logger.error({ err }, "failed to clear resumable stream"),
          );
        }
        const failure = disposalError
          ? new AggregateError([error, disposalError], "run setup and cleanup failed")
          : error;
        try {
          await failAgentRun({ ...leaseToken, error: failure, usage: contextUsage });
        } finally {
          await releaseRun(leaseToken).catch((err) => logger.error({ err, runId }, "lease release failed"));
        }
        return failure;
      },
    });
    throw failure;
  }
}

const REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const APPROVAL_POLICIES = new Set<ApprovalPolicy>(["never", "on-request", "unless-trusted", "granular"]);
const PERMISSION_PROFILES = new Set<BuiltInPermissionProfileId>([":read-only", ":workspace", ":danger-full-access"]);

function providerResumeBinding(provider: RuntimeProviderCapability) {
  return {
    id: provider.id,
    model: provider.model,
    baseUrl: provider.baseUrl,
    extraBody: provider.extraBody,
    contextWindow: provider.contextWindow,
    maxOutputTokens: provider.maxOutputTokens,
    supportsImageInput: provider.supportsImageInput,
    providerKind: provider.providerKind,
  };
}

export interface ClaimedRecoveryDependencies {
  getSession: typeof getSessionRow;
  getRun: typeof getAgentRunById;
  renewCapabilities(envelope: TurnResumeEnvelope, token: RunLeaseToken): Promise<TurnCapabilities>;
  execute(execution: ClaimedAgentRunExecution): Promise<Pick<Response, "arrayBuffer">>;
  fail(token: RunLeaseToken, error: unknown): Promise<void>;
  release(token: RunLeaseToken): Promise<void>;
}

const claimedRecoveryDefaults: ClaimedRecoveryDependencies = {
  getSession: getSessionRow,
  getRun: getAgentRunById,
  renewCapabilities: async () => {
    throw new Error("turn recovery requires a renewed upper-host capability");
  },
  execute: executeClaimedAgentRunResponse,
  fail: async (token, error) => {
    await failAgentRun({ ...token, error });
  },
  release: releaseRun,
};

/** Re-enter only a transactionally claimed physical attempt. Production recovery
 * fails closed until the upper host renews the secret-bearing capability. */
export async function resumeClaimedAgentRun(
  recovery: Extract<OrphanedTurnRecovery, { state: "claimed" }>,
  toolCatalog: ToolCatalog,
  deps: ClaimedRecoveryDependencies = claimedRecoveryDefaults,
): Promise<void> {
  const { envelope, token, decision } = recovery;
  try {
    const execution = envelope.snapshot.execution;
    if (envelope.compactorVersion !== CONTEXT_COMPACTOR_VERSION) {
      throw new Error("turn recovery compactor version no longer matches its resume envelope");
    }
    if (!REASONING_EFFORTS.has(execution.reasoningEffort as ReasoningEffort)) {
      throw new Error("turn recovery contains an invalid reasoning effort");
    }
    if (!APPROVAL_POLICIES.has(execution.approvalPolicy as ApprovalPolicy)) {
      throw new Error("turn recovery contains an invalid approval policy");
    }
    if (!PERMISSION_PROFILES.has(execution.permissionProfile as BuiltInPermissionProfileId)) {
      throw new Error("turn recovery contains an invalid permission profile");
    }
    const [session, capabilities, run] = await Promise.all([
      deps.getSession(envelope.sessionId),
      deps.renewCapabilities(envelope, token),
      deps.getRun(token.runId),
    ]);
    const provider = capabilities.provider;
    if (!run || run.sessionId !== envelope.sessionId) {
      throw new Error("turn recovery run no longer matches its resume envelope");
    }
    if (stableDigest(providerResumeBinding(provider)) !== stableDigest(execution.providerBinding)) {
      throw new Error("turn recovery provider binding changed after the attempt was admitted");
    }
    const leafMessageId = decision === "resume-next-step" ? run.outputMessageId : envelope.historyMessageId;
    if (!leafMessageId) throw new Error("turn recovery has no committed journal boundary");
    const response = await deps.execute({
      session,
      provider,
      claim: {
        runId: token.runId,
        attemptEpoch: token.attemptEpoch,
        duplicate: false,
        historyRevision: envelope.historyRevision,
        historyMessageId: envelope.historyMessageId,
        inputMessageId: null,
      },
      operation: execution.operation,
      input: {
        reasoningEffort: execution.reasoningEffort as ReasoningEffort,
        capabilities,
        trigger: execution.operation === "regenerate-message" ? "regenerate-message" : "submit-message",
        ...(execution.operation === "tool-continuation" || execution.operation === "edit-message"
          ? { messageId: envelope.historyMessageId }
          : {}),
        expectedRevision: envelope.historyRevision,
        requestId: `recovery-${token.runId}-${token.attemptEpoch.toString()}`,
        generateTitle: false,
      },
      toolCatalog,
      approvalPolicy: execution.approvalPolicy as ApprovalPolicy,
      permissionProfile: execution.permissionProfile as BuiltInPermissionProfileId,
      resume: { decision, envelope, leafMessageId },
    });
    await response.arrayBuffer();
  } catch (error) {
    await deps
      .fail(token, error)
      .catch((finishError) =>
        logger.error({ err: finishError, runId: token.runId }, "failed to terminalize recovered run"),
      );
    await deps.release(token).catch(() => undefined);
    throw error;
  }
}

export async function getAgentRunTrace(sessionId: string, runId: string): Promise<AgentRunTrace> {
  const businessRun = await getAgentRunById(runId);
  if (!businessRun) {
    throw new NotFoundError("agent run not found");
  }
  assertRunAccess(sessionId, businessRun);
  const trace = await getRunTrace(businessRun.id);
  if (!trace) {
    throw new NotFoundError("agent run trace not found");
  }
  return trace;
}

export interface SessionContextView {
  contextWindow: number | null;
  autoCompactAt: number | null;
  usedTokens: number;
  estimated: boolean;
  compacted: boolean;
  categories: Array<{
    id: ContextCategoryId;
    tokens: number;
  }>;
}

export async function getSessionContext(sessionId: string): Promise<{ context: SessionContextView | null }> {
  const session = await getSessionRow(sessionId);
  const [record, compacted] = await Promise.all([
    getLatestSessionContextRecord(sessionId),
    hasSessionContextCheckpoint(sessionId),
  ]);
  if (!record || record.providerId !== session.providerId || record.model !== session.model) {
    return { context: null };
  }
  const { snapshot } = record;
  return {
    context: {
      contextWindow: null,
      autoCompactAt: null,
      usedTokens: snapshot.usedTokens,
      estimated: record.totalEstimated,
      compacted,
      categories: snapshot.categories,
    },
  };
}
