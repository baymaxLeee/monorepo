import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText } from "ai";

import { getProvider, type ProviderSnapshot } from "../clients/admin.js";
import { getDocumentSlice, listDocuments } from "../clients/knowledge.js";
import { getSettings } from "../config.js";
import { AgentRuntimeError, RequestError } from "../lib/errors.js";
import type { AuthContext } from "../middleware/auth.js";
import {
  applyPlaceholderReplacements,
  buildAgentTools,
  extractSlotIds,
  type AgentToolContext,
} from "./agent-tools.js";
import {
  createMessage,
  listMessages,
  touchConversation,
  updateConversationProvider,
  type Message,
} from "./conversations.js";

export type AgentRunStreamEvent = Record<string, unknown>;

export interface RunAgentInput {
  prompt: string;
  providerId?: string | null;
  multimodalProviderId?: string | null;
  documentIds?: string[];
  thinking?: boolean | null;
  reasoningEffort?: "low" | "medium" | "high" | null;
}

function stepEvent(
  text: string,
  extra: Record<string, unknown> = {},
): AgentRunStreamEvent {
  return { type: "step", text, status: "completed", ...extra };
}

function messageEvent(
  partial: { delta?: string; text?: string; status?: string } = {},
): AgentRunStreamEvent {
  return { type: "message", role: "assistant", status: partial.status ?? "streaming", ...partial };
}

function cardEvent(doc: {
  id: string;
  title: string;
  filename: string;
  mime_type: string;
  kind: string;
  created_at: string;
  updated_at: string;
}): AgentRunStreamEvent {
  return {
    type: "card",
    card: {
      type: "artifact",
      document: {
        id: doc.id,
        conversation_id: null,
        kind: doc.kind,
        title: doc.title,
        filename: doc.filename,
        mime_type: doc.mime_type,
        ingest_status: "ready",
        ingest_progress: 100,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      },
    },
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n...[truncated]`;
}

async function buildSystemPrompt(): Promise<string> {
  return [
    "You are a general-purpose office assistant.",
    "Conversation history and referenced documents may be truncated.",
    "Inline references like [16hex] are knowledge-base document IDs; use read_document(document_id) for full content.",
    "Use list_documents and read_document when previews are insufficient.",
    "For images (charts, screenshots, scans), call analyze_image(document_id, question) to inspect the original picture with a multimodal model.",
    "Use web_search at most once for public web lookup.",
    "Answer directly for normal questions.",
    "When the user needs reusable file deliverables (.md, .html), call create_artifact then cite the returned placeholder token in your answer.",
    "For deliverables larger than a single create_artifact call, build them with repeated append_artifact_chunk calls (same filename) and a final done=true call.",
    "Never invent artifact IDs; only cite placeholders returned by create_artifact or append_artifact_chunk.",
  ].join("\n");
}

async function buildUserContent(
  auth: AuthContext,
  conversationId: string,
  prompt: string,
  history: Message[],
  slotIds: string[],
): Promise<string> {
  const settings = getSettings();
  const sections: string[] = [];

  const recent = history.slice(-settings.agentContextRecentMessages);
  if (recent.length) {
    const blocks = recent.map(
      (m, i) =>
        `### Message ${i + 1}\nRole: ${m.role}\nStatus: ${m.status}\n\n${truncate(m.content, settings.agentContextMessageMaxChars)}`,
    );
    sections.push(["<conversation_history>", ...blocks, "</conversation_history>"].join("\n\n"));
  }

  const docIds = new Set(slotIds);
  let docs = await listDocuments(auth.userId, conversationId);
  if (docIds.size) docs = docs.filter((d) => docIds.has(d.id));
  if (docs.length) {
    const previews = await Promise.all(
      docs.map(async (d) => {
        const slice = await getDocumentSlice(auth.userId, d.id, 0, 1200);
        return [
          `### Document: ${d.title}`,
          `Document ID: ${d.id}`,
          `Filename: ${d.filename}`,
          `Kind: ${d.kind}`,
          `Preview:`,
          slice.content,
        ].join("\n");
      }),
    );
    sections.push(
      ["<referenced_documents>", ...previews, "</referenced_documents>"].join("\n\n"),
    );
  }

  sections.push(["<current_user_request>", prompt, "</current_user_request>"].join("\n"));
  return sections.join("\n\n");
}

export async function* streamAgentRun(
  auth: AuthContext,
  conversationId: string,
  provider: ProviderSnapshot,
  input: RunAgentInput,
): AsyncGenerator<AgentRunStreamEvent> {
  const settings = getSettings();
  if (!input.prompt.trim() && !extractSlotIds(input.prompt).length) {
    throw new RequestError("agent prompt is required");
  }

  const steps: string[] = [];
  const partialParts: string[] = [];
  const emittedCardIds = new Set<string>();

  const pushStep = (text: string, extra?: Record<string, unknown>) => {
    steps.push(text);
    return stepEvent(text, extra);
  };

  yield pushStep("已接收任务 正在准备上下文");

  await updateConversationProvider(conversationId, provider.id, provider.model);
  const history = await listMessages(conversationId);
  if (history.length) yield pushStep(`已加载 ${history.length} 条历史消息`);

  const slotIds = [
    ...new Set([...(input.documentIds ?? []), ...extractSlotIds(input.prompt)]),
  ];

  await createMessage({
    conversationId,
    role: "user",
    content: input.prompt,
    status: "ok",
  });

  const toolCtx: AgentToolContext = {
    auth,
    conversationId,
    placeholderMap: new Map(),
    createdDocuments: [],
    placeholderCounter: 0,
    multimodalProvider: null,
    artifactBuilders: new Map(),
    artifactTotalChars: 0,
  };

  if (input.multimodalProviderId) {
    try {
      toolCtx.multimodalProvider = await getProvider(auth.userId, input.multimodalProviderId);
      yield pushStep(`已就绪多模态模型: ${toolCtx.multimodalProvider.model}`);
    } catch {
      toolCtx.multimodalProvider = null;
    }
  }

  const openai = createOpenAICompatible({
    name: provider.name,
    baseURL: provider.baseUrl,
    apiKey: provider.apiKey,
    // Provider-configured extra body acts as defaults; AI-SDK computed fields
    // (model/messages/max_tokens) take precedence so a stray extra_body
    // max_tokens cannot override our runtime cap.
    transformRequestBody: (body) => ({ ...provider.extraBody, ...body }),
  });

  const reasoningEffort = input.reasoningEffort ?? (input.thinking ? "medium" : null);
  const providerOptions = reasoningEffort
    ? { [provider.name]: { reasoningEffort } }
    : undefined;

  const tools = buildAgentTools(toolCtx);
  const userContent = await buildUserContent(auth, conversationId, input.prompt, history, slotIds);

  try {
    yield pushStep("正在调用模型", { status: "running" });

    const result = streamText({
      model: openai(provider.model),
      system: await buildSystemPrompt(),
      messages: [{ role: "user", content: userContent }],
      tools,
      stopWhen: stepCountIs(settings.agentMaxTurns),
      maxOutputTokens: settings.llmMaxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
    });

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        partialParts.push(part.text);
        yield messageEvent({ delta: part.text });
      } else if (part.type === "tool-call") {
        yield pushStep(`正在调用工具: ${part.toolName}`, { status: "running", tool_name: part.toolName });
      } else if (part.type === "tool-result") {
        const preview = String(part.output).slice(0, 500);
        yield pushStep(`工具执行完成: ${part.toolName}`, {
          tool_name: part.toolName,
          output_preview: preview,
        });
        for (const doc of toolCtx.createdDocuments) {
          if (!emittedCardIds.has(doc.id)) {
            emittedCardIds.add(doc.id);
            yield cardEvent(doc);
          }
        }
      }
    }

    yield pushStep("模型响应完成");

    let finalText = applyPlaceholderReplacements(
      partialParts.join(""),
      toolCtx.placeholderMap,
      toolCtx.createdDocuments,
    );

    for (const doc of toolCtx.createdDocuments) {
      if (!emittedCardIds.has(doc.id)) {
        emittedCardIds.add(doc.id);
        yield cardEvent(doc);
      }
    }

    const assistantContent = [steps.map((s) => `- ${s}`).join("\n"), finalText]
      .filter(Boolean)
      .join("\n\n");

    await createMessage({
      conversationId,
      role: "assistant",
      content: assistantContent,
      status: "ok",
    });
    await touchConversation(conversationId);

    yield messageEvent({ text: finalText, status: "completed" });
  } catch (err) {
    const partial = partialParts.join("").trim();
    const summary = partial || `[agent] 运行失败: ${String(err)}`;
    await createMessage({
      conversationId,
      role: "assistant",
      content: summary,
      status: "failed",
    });
    throw new AgentRuntimeError("agent run failed", {
      provider: provider.name,
      reason: String(err),
    });
  }
}
