import { createHash, randomBytes } from "node:crypto";

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from "ai";

import type { AgentSkillRef, ProviderSnapshot } from "../../clients/admin.js";
import { getSkillBody } from "../../clients/admin.js";
import { getDocument } from "../../clients/knowledge.js";
import type { PersistedMessageContent } from "../../db/schema.js";
import { NotFoundError, RequestError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
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
  finalizeCancelledRunToolCalls,
  finalizeRunToolCallsFromParts,
  getAgentRunById,
  getRunTrace,
  type AgentRunTrace,
} from "./repository.js";
import { finalizeCancelledParts } from "./cancellation.js";
import { createAgent } from "../agents/factory.js";
import { extractMemoryCandidates } from "../memory/extractor.js";
import { extractUsageTokens, failAgentRun } from "../observability/lifecycle.js";
import {
  activatedSkillNameFromParts,
  attachedImageDocumentIdsFromParts,
  hasUntrustedFilePart,
  referencedDocumentIdsFromParts,
} from "../context/file-parts.js";
import { projectModelContext } from "../context/projector.js";
import { SYSTEM_SKILL_NAMES } from "../integrations/skills/provider.js";
import { loadInstructionContext } from "../context/instruction-loader.js";
import type { BotProfileSnapshot } from "../context/instructions/index.js";
import { acquireRunLease, registerRunController, releaseRun } from "./lease.js";
import { mergeClientContinuation } from "./continuation.js";
import {
  activateAgentStream,
  consumeAgentSseStream,
  deactivateAgentStream,
} from "../streams/service.js";

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

function persistedMessageToUiMessage(message: Message): AnyUIMessage {
  const parts = partsFromPersistedContent(message.content);
  return {
    id: message.id,
    role: message.role,
    parts: parts ?? [],
  } as AnyUIMessage;
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
  const latestUser = [...uiMessages].reverse().find((message) => message.role === "user");
  if (latestUser && hasUntrustedFilePart(latestUser.parts)) {
    throw new RequestError("file attachments must reference a conversation document");
  }
  const requestedDocumentIds = latestUser
    ? [...new Set(referencedDocumentIds(latestUser))]
    : [];
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

  let resumable = false;
  try {
    await activateAgentStream(conversation.id, runId);
    resumable = true;
  } catch (error) {
    logger.error({ err: error }, "failed to activate resumable stream");
  }

  let disposeAgentResources: (() => Promise<void>) | null = null;
  try {
    const mode = input.mode === "plan" ? "plan" : "normal";
    const [persistedMessages, instructionInput] = await Promise.all([
      listMessages(conversation.id),
      loadInstructionContext({
        userId: conversation.userId,
        conversationId: conversation.id,
        documentIds: requestedDocumentIds,
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
      const mergedMessage = mergeClientContinuation(
        historyMessages[continuationIndex]!,
        latestMessage,
      );
      await updateMessageContent({
        id: mergedMessage.id,
        conversationId: conversation.id,
        content: serializeMessageContent(mergedMessage),
        status: "ok",
      });
      modelUiMessages = [...historyMessages];
      modelUiMessages[continuationIndex] = mergedMessage;
    }

    const memorySourceUser =
      latestUser ?? [...modelUiMessages].reverse().find((message) => message.role === "user");
    const memorySourceText = memorySourceUser ? textFromUiMessage(memorySourceUser) : "";

    const runSignal = registerRunController(runId);
    const projected = await projectModelContext({
      conversationId: conversation.id,
      userId: conversation.userId,
      mode,
      activePlanDocumentId: conversation.activePlanDocumentId,
      contextWindow: provider.contextWindow,
      maxOutputTokens: provider.maxOutputTokens,
      supportsImageInput: provider.supportsImageInput,
      messages: await validateUIMessages<AnyUIMessage>({ messages: modelUiMessages }),
    });
    const modelMessages = projected.messages;
    instructionInput.extraContext = projected.instructionContext;

    // Admin skills may never shadow a code-governed system skill, on any path
    // (load_skill catalog OR explicit `/` activation). Filter reserved names out
    // of the single source so both consumers see the same safe set.
    const botSkills = (input.botSkills ?? []).filter((skill) => {
      if (SYSTEM_SKILL_NAMES.has(skill.name)) {
        console.warn(
          `[chat-agent] dropping bot skill "${skill.name}": name is reserved by a built-in system skill`,
        );
        return false;
      }
      return true;
    });

    // Explicit `/` skill activation: inject the picked skill's full body into
    // this turn so it is consumed deterministically, independent of whether the
    // model also chooses to call load_skill. The activation rides the latest
    // user message as a `data-skill-activation` part (persisted, so reload and
    // tool continuation keep it); older turns' parts are dropped from model
    // context by the projector, so the body is only ever injected for the turn
    // that message triggers. The user explicitly asked for this skill, so any
    // failure here fails the run with a visible error rather than silently
    // degrading to a plain chat.
    const activatedSkillName = latestUser
      ? activatedSkillNameFromParts(latestUser.parts)
      : null;
    if (activatedSkillName) {
      const picked = botSkills.find((skill) => skill.name === activatedSkillName);
      if (!picked) {
        throw new RequestError(`skill "${activatedSkillName}" is not available for this agent`);
      }
      // getSkillBody throws RequestError (404) / AdminUnavailableError (502);
      // let those propagate so the client sees why the skill could not load.
      const { body } = await getSkillBody(picked.id, auth.orgId);
      if (!body.trim()) {
        throw new RequestError(`skill "${picked.name}" has no content to load`);
      }
      instructionInput.extraContext = [
        ...instructionInput.extraContext,
        { kind: "activated_skill", name: picked.name, body },
      ];
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
      attachedImageDocumentIds: latestUser
        ? attachedImageDocumentIdsFromParts(latestUser.parts)
        : [],
      instructionInput,
      botSkills,
      loadSkillBody: async (skillId: string) => (await getSkillBody(skillId, auth.orgId)).body,
    });
    const agent = agentInstance.agent;
    disposeAgentResources = agentInstance.dispose;
    const result = await agent.stream({ messages: modelMessages, abortSignal: runSignal });
    logger.info(
      { conversationId: conversation.id, runId, setupMs: Math.round(performance.now() - startedAt) },
      "run accepted",
    );
    const agentUiStream = toUIMessageStream({
      stream: result.stream,
      tools: agent.tools,
      originalMessages: modelUiMessages,
      generateMessageId: () => assistantMessageId,
      sendSources: true,
      onError: (error) => {
        logger.error({ err: error }, "stream failed");
        return describeStreamError(error);
      },
      onEnd: async ({ responseMessage, isContinuation, isAborted, finishReason }) => {
        const currentRun = await getAgentRunById(runId).catch(() => null);
        const aborted =
          isAborted || runSignal.aborted || currentRun?.status === "cancel_requested";
        const failed = finishReason === "error";
        try {
          const sanitizedParts = sanitizePersistedParts(responseMessage.parts);
          const parts = aborted
            ? finalizeCancelledParts(sanitizedParts)
            : sanitizedParts;
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
          const tokens = extractUsageTokens(usage);
          if (aborted) await finalizeCancelledRunToolCalls(runId);
          else await finalizeRunToolCallsFromParts(runId, parts);
          await finishAgentRun({
            runId,
            status: aborted ? "cancelled" : failed ? "failed" : "completed",
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
            }).catch((error) =>
              logger.error({ err: error }, "memory extraction failed (non-fatal)"),
            );
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
              if (!title) return;
              await setConversationTitle(conversation.id, title);
              writer.write({
                type: "data-conversation-title",
                data: { title },
                transient: true,
              });
            })().catch((error) =>
              logger.error({ err: error }, "conversation title update failed (non-fatal)"),
            );
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
        ? ({ stream }) => consumeAgentSseStream(conversation.id, runId, stream)
        : undefined,
    });
  } catch (error) {
    await disposeAgentResources?.();
    if (resumable) {
      await deactivateAgentStream(conversation.id, runId).catch((streamError) =>
        logger.error({ err: streamError }, "failed to clear resumable stream"),
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

  if (part.type === "tool-knowledge_search" && "output" in part && part.output) {
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
