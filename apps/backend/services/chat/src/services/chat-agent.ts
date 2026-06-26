import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import { z } from "zod";
import {
  artifactRevisionPrompt,
  artifactSystemPrompt,
  imageDataUrl,
  normalizeArtifactContent,
  resolveArtifactKind,
  safeFilename,
  type ArtifactKind,
  validateArtifactContent,
} from "./agent-artifacts.js";
import {
  createProviderModel,
  type ChatWorkflowProvider,
  type ReasoningEffort,
} from "./agent-provider.js";

type WorkflowStreamOptions = Parameters<WorkflowAgent["stream"]>[0];
type WorkflowModelMessage = NonNullable<WorkflowStreamOptions["messages"]>[number];

interface ArtifactCompletion {
  action: "created" | "updated";
  documentId: string;
  title: string;
  filename: string;
  kind: string;
  totalChars?: number;
}

interface CompletionOutput {
  text: string;
  streamAppendText: string;
}

export interface ChatWorkflowInput {
  runId: string;
  userId: string;
  conversationId: string;
  provider: ChatWorkflowProvider;
  multimodalProviderId?: string | null;
  modelMessages: WorkflowModelMessage[];
  instructions: string;
  reasoningEffort?: ReasoningEffort | null;
}

const toolContextSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  providerId: z.string(),
  multimodalProviderId: z.string().nullable().optional(),
});

type ToolContext = z.infer<typeof toolContextSchema>;

function stopAtStepCount(stepCount: number) {
  return ({ steps }: { steps: unknown[] }) => steps.length === stepCount;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function artifactCompletionFromToolResult(result: unknown): ArtifactCompletion | null {
  if (!isRecord(result)) return null;
  const toolName = result.toolName;
  if (toolName !== "create_artifact" && toolName !== "update_artifact") return null;

  const output = result.output;
  if (!isRecord(output) || output.ok !== true || output.status !== "persisted") return null;
  if (typeof output.document_id !== "string") return null;

  const title = typeof output.title === "string" && output.title.trim()
    ? output.title.trim()
    : "未命名 artifact";
  const filename = typeof output.filename === "string" && output.filename.trim()
    ? output.filename.trim()
    : "artifact";
  const kind = typeof output.kind === "string" && output.kind.trim()
    ? output.kind.trim()
    : "artifact";
  const totalChars = typeof output.total_chars === "number" && Number.isFinite(output.total_chars)
    ? output.total_chars
    : undefined;

  return {
    action: toolName === "create_artifact" ? "created" : "updated",
    documentId: output.document_id,
    title,
    filename,
    kind,
    totalChars,
  };
}

function collectArtifactCompletions(steps: readonly unknown[]): ArtifactCompletion[] {
  const byDocumentId = new Map<string, ArtifactCompletion>();
  for (const step of steps) {
    if (!isRecord(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      const artifact = artifactCompletionFromToolResult(result);
      if (artifact) byDocumentId.set(artifact.documentId, artifact);
    }
  }
  return [...byDocumentId.values()];
}

function buildArtifactCompletionSummary(artifacts: ArtifactCompletion[]): string {
  if (!artifacts.length) return "";
  const lines = artifacts.map((artifact) => {
    const verb = artifact.action === "created" ? "已创建" : "已更新";
    const size = artifact.totalChars ? `，约 ${artifact.totalChars} 字符` : "";
    return `- ${verb}「${artifact.title}」（${artifact.filename}，${artifact.kind}${size}）`;
  });
  return ["执行完成，Artifact 已保存：", ...lines].join("\n");
}

function buildCompletionOutput(modelText: string, artifacts: ArtifactCompletion[]): CompletionOutput {
  const text = modelText.trim();
  const artifactSummary = buildArtifactCompletionSummary(artifacts);
  if (!artifactSummary) {
    const fallback = text || "执行完成。";
    return { text: fallback, streamAppendText: text ? "" : fallback };
  }
  if (!text) return { text: artifactSummary, streamAppendText: artifactSummary };

  const hasArtifactSummary = artifacts.every((artifact) => {
    return text.includes(artifact.title) || text.includes(artifact.filename);
  });
  return hasArtifactSummary
    ? { text, streamAppendText: "" }
    : { text: `${text}\n\n${artifactSummary}`, streamAppendText: `\n\n${artifactSummary}` };
}

function buildAssistantParts(
  text: string,
  artifacts: ArtifactCompletion[],
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = artifacts.map((artifact) => ({
    type: `tool-${artifact.action === "created" ? "create_artifact" : "update_artifact"}`,
    toolCallId: `artifact-${artifact.documentId}`,
    state: "output-available",
    input: {},
    output: {
      ok: true,
      status: "persisted",
      document_id: artifact.documentId,
      title: artifact.title,
      filename: artifact.filename,
      kind: artifact.kind,
      total_chars: artifact.totalChars,
    },
  }));
  if (text.trim()) parts.push({ type: "text", text });
  return parts.length ? parts : [{ type: "text", text: "执行完成。" }];
}

async function buildArtifactTextModel(userId: string, providerId: string) {
  const [{ getProvider }, { streamText }] = await Promise.all([
    import("../clients/admin.js"),
    import("ai"),
  ]);
  const provider = await getProvider(userId, providerId);
  return { model: createProviderModel(provider, { disableReasoning: true }), streamText };
}

async function listDocumentsTool(_input: {}, { context }: { context: ToolContext }) {
  "use step";
  const { listDocuments } = await import("../clients/knowledge.js");
  const rows = await listDocuments(context.userId, context.conversationId);
  return {
    ok: true,
    documents: rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      filename: r.filename,
      mime_type: r.mime_type,
      ingest_status: r.ingest_status,
    })),
  };
}

async function readDocumentTool(
  input: { document_id: string; start: number; max_chars: number },
  { context }: { context: ToolContext },
) {
  "use step";
  const { getDocumentSlice } = await import("../clients/knowledge.js");
  try {
    const slice = await getDocumentSlice(
      context.userId,
      input.document_id,
      input.start,
      input.max_chars,
    );
    return {
      ok: true,
      document_id: slice.id,
      title: slice.title,
      filename: slice.filename,
      mime_type: slice.mime_type,
      start: slice.start,
      total_chars: slice.total_chars,
      next_start: slice.next_start,
      content: slice.content,
      untrusted: true,
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function webSearchTool(
  input: { query: string; max_results: number },
  _options: { context: ToolContext },
) {
  "use step";
  const { getSettings } = await import("../config.js");
  const settings = getSettings();
  if (!settings.tavilyApiKey) return { ok: false, error: "TAVILY_API_KEY is not configured" };
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.tavilyApiKey}`,
      },
      body: JSON.stringify({
        query: input.query,
        max_results: input.max_results,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 500)}` };
    }
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string | null;
        score?: number;
      }>;
    };
    return {
      ok: true,
      query: input.query,
      untrusted: true,
      results: (data.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
        published_date: r.published_date ?? null,
        score: r.score ?? null,
      })),
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function createArtifactTool(
  input: { title: string; filename: string; kind: "html" | "markdown"; brief: string },
  { context }: { context: ToolContext },
) {
  "use step";
  const [{ createArtifact }, { model, streamText }] = await Promise.all([
    import("../clients/knowledge.js"),
    buildArtifactTextModel(context.userId, context.providerId),
  ]);
  const result = streamText({
    model,
    system: artifactSystemPrompt(input.kind),
    prompt: input.brief,
  });
  const raw = (await result.text).trim();
  if (!raw) return { ok: false, error: "artifact generation returned empty content" };
  const content = normalizeArtifactContent(input.kind, raw);
  const validation = validateArtifactContent(input.kind, content);
  if (!validation.ok) return { ok: false, error: validation.error ?? "artifact validation failed" };
  const filename = safeFilename(input.filename);
  const doc = await createArtifact({
    userId: context.userId,
    conversationId: context.conversationId,
    title: input.title,
    filename,
    content,
    mimeType: input.kind === "html" ? "text/html" : "text/markdown",
  });
  return {
    ok: true,
    status: "persisted",
    document_id: doc.id,
    title: doc.title,
    filename: doc.filename,
    kind: input.kind,
    total_chars: content.length,
  };
}

async function updateArtifactTool(
  input: {
    document_id: string;
    title?: string;
    filename?: string;
    kind?: ArtifactKind;
    brief: string;
  },
  { context }: { context: ToolContext },
) {
  "use step";
  const [{ getDocument, updateArtifact }, { model, streamText }] = await Promise.all([
    import("../clients/knowledge.js"),
    buildArtifactTextModel(context.userId, context.providerId),
  ]);
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") {
      return { ok: false, error: `document ${input.document_id} is not an artifact` };
    }
    const artifactKind = resolveArtifactKind(current, input.kind);
    const filename = input.filename ? safeFilename(input.filename) : current.filename;
    const result = streamText({
      model,
      system: artifactSystemPrompt(artifactKind),
      prompt: artifactRevisionPrompt(artifactKind, current.content_md ?? "", input.brief),
    });
    const raw = (await result.text).trim();
    if (!raw) return { ok: false, error: "artifact revision returned empty content" };
    const content = normalizeArtifactContent(artifactKind, raw);
    const validation = validateArtifactContent(artifactKind, content);
    if (!validation.ok) return { ok: false, error: validation.error ?? "artifact validation failed" };
    const doc = await updateArtifact({
      userId: context.userId,
      documentId: input.document_id,
      title: input.title,
      filename,
      content,
      mimeType: artifactKind === "html" ? "text/html" : "text/markdown",
    });
    return {
      ok: true,
      status: "persisted",
      document_id: doc.id,
      title: doc.title,
      filename: doc.filename,
      kind: artifactKind,
      total_chars: content.length,
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function analyzeImageTool(
  input: { document_id: string; question: string },
  { context }: { context: ToolContext },
) {
  "use step";
  if (!context.multimodalProviderId) {
    return {
      ok: false,
      error:
        "no multimodal provider configured for this run; use read_document or ask the user to select a multimodal model",
    };
  }
  const [{ getProvider }, { getDocumentSource }, { generateText }] = await Promise.all([
    import("../clients/admin.js"),
    import("../clients/knowledge.js"),
    import("ai"),
  ]);
  try {
    const provider = await getProvider(context.userId, context.multimodalProviderId);
    const { bytes, mimeType } = await getDocumentSource(context.userId, input.document_id);
    if (!mimeType.toLowerCase().startsWith("image/")) {
      return {
        ok: false,
        error: `document ${input.document_id} is not an image (${mimeType}); use read_document instead`,
      };
    }
    const result = await generateText({
      model: createProviderModel(provider),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.question },
            { type: "image", image: imageDataUrl(bytes, mimeType) },
          ],
        },
      ],
    });
    const text = result.text.trim();
    return {
      ok: true,
      document_id: input.document_id,
      mime_type: mimeType,
      analysis: text || "No analysis returned by the multimodal model.",
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

function buildWorkflowTools() {
  return {
    list_documents: {
      description: "List knowledge-base documents for this user.",
      inputSchema: z.object({}),
      contextSchema: toolContextSchema,
      execute: listDocumentsTool,
    },
    read_document: {
      description: "Read a slice of a document's markdown/html content by document id.",
      inputSchema: z.object({
        document_id: z.string(),
        start: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(1).max(8000).default(4000),
      }),
      contextSchema: toolContextSchema,
      execute: readDocumentTool,
    },
    web_search: {
      description: "Search the public web for current information using Tavily.",
      inputSchema: z.object({
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(8).default(5),
      }),
      contextSchema: toolContextSchema,
      execute: webSearchTool,
    },
    create_artifact: {
      description:
        "Create a persistent markdown or html artifact. Pass a compact brief; the tool generates and persists the file content internally.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        filename: z.string().min(1).max(160),
        kind: z.enum(["html", "markdown"]).default("markdown"),
        brief: z.string().min(1),
      }),
      contextSchema: toolContextSchema,
      execute: createArtifactTool,
    },
    update_artifact: {
      description:
        "Update an existing artifact in place. Pass document_id and a compact brief describing the requested changes.",
      inputSchema: z.object({
        document_id: z.string().min(1).max(32),
        title: z.string().min(1).max(120).optional(),
        filename: z.string().min(1).max(160).optional(),
        kind: z.enum(["html", "markdown"]).optional(),
        brief: z.string().min(1),
      }),
      contextSchema: toolContextSchema,
      execute: updateArtifactTool,
    },
    analyze_image: {
      description:
        "Analyze an uploaded image document with a multimodal model. Use when markdown preview is insufficient.",
      inputSchema: z.object({
        document_id: z.string(),
        question: z.string().min(1).max(2000),
      }),
      contextSchema: toolContextSchema,
      execute: analyzeImageTool,
    },
    ask_user: {
      description:
        "Ask the user for missing information required to continue. Use for clarification, not artifact confirmation. Supports single-choice, multi-choice, and freeform answers.",
      inputSchema: z.object({
        question: z.string().min(1).max(240),
        choices: z
          .array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(160) }))
          .max(8)
          .default([]),
        mode: z.enum(["single", "multiple"]).default("single"),
        allow_freeform: z.boolean().default(true),
        freeform_label: z.string().min(1).max(40).default("其他"),
      }),
    },
  };
}

function stepId(runId: string, stepNumber: number): string {
  const compact = runId.replace(/[^a-f0-9]/gi, "").padEnd(30, "0").slice(0, 30);
  return `${compact}${stepNumber.toString(16).padStart(2, "0").slice(-2)}`;
}

async function startModelStep(input: {
  runId: string;
  stepNumber: number;
  model: string;
}): Promise<void> {
  "use step";
  const { startAgentStep } = await import("./agent-state.js");
  await startAgentStep({
    stepId: stepId(input.runId, input.stepNumber),
    runId: input.runId,
    stepIndex: input.stepNumber,
    kind: "model",
    summary: "model step started",
    metadata: { model: input.model },
  });
}

async function finishModelStep(input: {
  runId: string;
  stepNumber: number;
  finishReason: string;
  usage: unknown;
  toolCallCount: number;
}): Promise<void> {
  "use step";
  const { finishAgentStep } = await import("./agent-state.js");
  await finishAgentStep({
    stepId: stepId(input.runId, input.stepNumber),
    status: "completed",
    summary: `finish reason: ${input.finishReason}`,
    metadata: {
      usage: input.usage,
      tool_call_count: input.toolCallCount,
    },
  });
}

function sanitizeToolInput(toolName: string, input: unknown): unknown {
  if (
    (toolName !== "create_artifact" && toolName !== "update_artifact") ||
    typeof input !== "object" ||
    input == null ||
    !("brief" in input)
  ) {
    return input;
  }
  const brief = (input as { brief?: unknown }).brief;
  if (typeof brief !== "string" || brief.length <= 400) return input;
  return {
    ...(input as Record<string, unknown>),
    brief: `${brief.slice(0, 400).trimEnd()}\n...[truncated ${brief.length} chars]`,
  };
}

async function recordToolStart(input: {
  runId: string;
  toolCallId: string;
  stepNumber: number;
  toolName: string;
  toolInput: unknown;
}): Promise<void> {
  "use step";
  const { recordToolCallStart } = await import("./agent-state.js");
  await recordToolCallStart({
    runId: input.runId,
    toolCallId: input.toolCallId,
    stepIndex: input.stepNumber,
    toolName: input.toolName,
    toolInput: sanitizeToolInput(input.toolName, input.toolInput),
  });
}

async function recordToolEnd(input: {
  toolCallId: string;
  success: boolean;
  output?: unknown;
  error?: unknown;
  durationMs: number;
}): Promise<void> {
  "use step";
  const { recordToolCallFinish } = await import("./agent-state.js");
  await recordToolCallFinish({
    toolCallId: input.toolCallId,
    status: input.success ? "completed" : "failed",
    output: input.success ? input.output : undefined,
    error: input.success ? undefined : input.error,
    durationMs: input.durationMs,
  });
}

async function persistWorkflowCompletion(input: {
  runId: string;
  conversationId: string;
  text: string;
  parts: Array<Record<string, unknown>>;
  totalTokens?: number | null;
}): Promise<void> {
  "use step";
  const [{ createMessage, touchConversation }, { finishAgentRun }] = await Promise.all([
    import("./conversations.js"),
    import("./agent-state.js"),
  ]);
  const assistant = await createMessage({
    conversationId: input.conversationId,
    role: "assistant",
    content: JSON.stringify({
      version: 1,
      parts: input.parts,
    }),
    status: "ok",
  });
  await finishAgentRun({
    runId: input.runId,
    status: "completed",
    outputMessageId: assistant.id,
    totalTokens: input.totalTokens ?? null,
  });
  await touchConversation(input.conversationId);
}

async function finishWorkflowStream(
  writable: WritableStream<any>,
  appendText: string,
): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try {
    if (appendText.length) {
      const id = "completion-summary";
      await writer.write({ type: "text-start", id });
      await writer.write({ type: "text-delta", id, text: appendText });
      await writer.write({ type: "text-end", id });
    }
    await writer.write({ type: "finish" });
  } finally {
    writer.releaseLock();
  }
  await writable.close();
}

async function failWorkflowRun(input: {
  runId: string;
  error: unknown;
}): Promise<void> {
  "use step";
  const { finishAgentRun } = await import("./agent-state.js");
  await finishAgentRun({
    runId: input.runId,
    status: "failed",
    error: input.error,
  });
}

export async function runChatAgent(input: ChatWorkflowInput): Promise<{ text: string }> {
  "use workflow";

  const provider = input.provider;
  const model = createProviderModel(provider, { reasoningEffort: input.reasoningEffort });
  const tools = buildWorkflowTools();
  const toolContext = {
    userId: input.userId,
    conversationId: input.conversationId,
    providerId: provider.id,
    multimodalProviderId: input.multimodalProviderId ?? null,
  };
  let finalText = "";
  let finalStreamAppendText = "";
  let finalArtifacts: ArtifactCompletion[] = [];
  let finalTotalTokens: number | null = null;
  const writable = getWritable<ModelCallStreamPart>();

  const agent = new WorkflowAgent({
    id: "chat-agent",
    model,
    instructions: input.instructions,
    tools,
    toolsContext: {
      list_documents: toolContext,
      read_document: toolContext,
      web_search: toolContext,
      create_artifact: toolContext,
      update_artifact: toolContext,
      analyze_image: toolContext,
    },
    experimental_onStepStart: (event) =>
      startModelStep({
        runId: input.runId,
        stepNumber: event.stepNumber,
        model: provider.model,
      }),
    onStepEnd: (event) =>
      finishModelStep({
        runId: input.runId,
        stepNumber: event.stepNumber,
        finishReason: event.finishReason,
        usage: event.usage,
        toolCallCount: event.toolCalls.length,
      }),
    onToolExecutionStart: (event) =>
      recordToolStart({
        runId: input.runId,
        toolCallId: event.toolCall.toolCallId,
        stepNumber: event.stepNumber,
        toolName: event.toolCall.toolName,
        toolInput: event.toolCall.input,
      }),
    onToolExecutionEnd: (event) =>
      recordToolEnd({
        toolCallId: event.toolCall.toolCallId,
        success: event.success,
        output: event.success ? event.output : undefined,
        error: event.success ? undefined : event.error,
        durationMs: event.durationMs,
      }),
    onEnd: (event) => {
      const artifacts = collectArtifactCompletions(event.steps);
      const completion = buildCompletionOutput(event.text, artifacts);
      finalText = completion.text;
      finalStreamAppendText = completion.streamAppendText;
      finalArtifacts = artifacts;
      finalTotalTokens = event.totalUsage?.totalTokens ?? null;
    },
  });

  try {
    await agent.stream({
      messages: input.modelMessages,
      writable,
      stopWhen: stopAtStepCount(12),
      sendFinish: false,
      preventClose: true,
      onError: (event) => {
        console.error("[chat-agent] WorkflowAgent stream error", event.error);
      },
    });
    await persistWorkflowCompletion({
      runId: input.runId,
      conversationId: input.conversationId,
      text: finalText,
      parts: buildAssistantParts(finalText, finalArtifacts),
      totalTokens: finalTotalTokens,
    });
    await finishWorkflowStream(writable, finalStreamAppendText);
    return { text: finalText };
  } catch (err) {
    console.error("[chat-agent] runChatAgent failed", err);
    await failWorkflowRun({ runId: input.runId, error: err });
    throw err;
  }
}
