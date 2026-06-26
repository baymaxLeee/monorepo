import {
  WorkflowAgent,
  type ModelCallStreamPart,
  type WorkflowAgentStreamResult,
} from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import { z } from "zod";
import { askUserHook } from "./agent-hooks.js";
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

type AgentStep = WorkflowAgentStreamResult["steps"][number];
type AgentContentPart = AgentStep["content"][number];
type AssistantPart = Record<string, unknown>;

const MAX_AGENT_STEPS = 12;

function stepCountAtLeast(limit: number) {
  return ({ steps }: { steps: readonly unknown[] }) => steps.length >= limit;
}

function contentPartToAssistantPart(
  part: AgentContentPart,
  results: ReadonlyMap<string, AgentContentPart>,
  errors: ReadonlyMap<string, AgentContentPart>,
): AssistantPart | null {
  switch (part.type) {
    case "text":
      return part.text.trim() ? { type: "text", text: part.text } : null;
    case "reasoning":
      return part.text.trim() ? { type: "reasoning", text: part.text } : null;
    case "source":
      return part.sourceType === "url"
        ? { type: "source-url", sourceId: part.id, url: part.url, title: part.title }
        : null;
    case "tool-call": {
      const error = errors.get(part.toolCallId);
      if (error && "error" in error) {
        return {
          type: `tool-${part.toolName}`,
          toolCallId: part.toolCallId,
          state: "output-error",
          input: part.input,
          errorText: String((error as { error: unknown }).error).slice(0, 2000),
        };
      }
      const result = results.get(part.toolCallId);
      if (result && "output" in result) {
        return {
          type: `tool-${part.toolName}`,
          toolCallId: part.toolCallId,
          state: "output-available",
          input: part.input,
          output: (result as { output: unknown }).output,
        };
      }
      return {
        type: `tool-${part.toolName}`,
        toolCallId: part.toolCallId,
        state: "input-available",
        input: part.input,
      };
    }
    default:
      return null;
  }
}

function stepsToAssistantParts(steps: readonly AgentStep[]): AssistantPart[] {
  const results = new Map<string, AgentContentPart>();
  const errors = new Map<string, AgentContentPart>();
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === "tool-result") results.set(part.toolCallId, part);
      else if (part.type === "tool-error") errors.set(part.toolCallId, part);
    }
  }
  const parts: AssistantPart[] = [];
  for (const step of steps) {
    for (const part of step.content) {
      const mapped = contentPartToAssistantPart(part, results, errors);
      if (mapped) parts.push(mapped);
    }
  }
  if (!parts.some((part) => part.type === "text")) {
    parts.push({ type: "text", text: "执行完成。" });
  }
  return parts;
}

async function buildArtifactTextModel(userId: string, providerId: string) {
  const [{ getProvider }, { streamText }] = await Promise.all([
    import("../clients/admin.js"),
    import("ai"),
  ]);
  const provider = await getProvider(userId, providerId);
  return { model: createProviderModel(provider, { disableReasoning: true }), streamText };
}

const ARTIFACT_STREAM_NAMESPACE = "artifact";
const ARTIFACT_STREAM_MIN_DELTA_CHARS = 240;

type ArtifactStreamData = {
  toolCallId: string;
  status: "generating" | "persisted" | "error";
  title: string;
  filename: string;
  kind: ArtifactKind;
  content?: string;
  document_id?: string;
};

async function streamArtifactContent(
  toolCallId: string,
  meta: { title: string; filename: string; kind: ArtifactKind },
  result: { textStream: AsyncIterable<string> },
): Promise<string> {
  const writable = getWritable<{ type: string; id: string; data: ArtifactStreamData }>({
    namespace: ARTIFACT_STREAM_NAMESPACE,
  });
  const writer = writable.getWriter();
  let raw = "";
  let lastSentLength = 0;

  const writeSnapshot = async (status: ArtifactStreamData["status"]) => {
    lastSentLength = raw.length;
    await writer.write({
      type: "data-artifact",
      id: toolCallId,
      data: { toolCallId, status, ...meta, content: raw },
    });
  };

  try {
    for await (const delta of result.textStream) {
      raw += delta;
      if (
        lastSentLength === 0 ||
        raw.length - lastSentLength >= ARTIFACT_STREAM_MIN_DELTA_CHARS
      ) {
        await writeSnapshot("generating");
      }
    }
    if (raw.length !== lastSentLength) {
      await writeSnapshot("generating");
    }
  } finally {
    writer.releaseLock();
  }
  return raw;
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
  { context, toolCallId }: { context: ToolContext; toolCallId: string },
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
  const filename = safeFilename(input.filename);
  const raw = (
    await streamArtifactContent(
      toolCallId,
      { title: input.title, filename, kind: input.kind },
      result,
    )
  ).trim();
  if (!raw) return { ok: false, error: "artifact generation returned empty content" };
  const content = normalizeArtifactContent(input.kind, raw);
  const validation = validateArtifactContent(input.kind, content);
  if (!validation.ok) return { ok: false, error: validation.error ?? "artifact validation failed" };
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
  { context, toolCallId }: { context: ToolContext; toolCallId: string },
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
    const raw = (
      await streamArtifactContent(
        toolCallId,
        { title: input.title ?? current.title, filename, kind: artifactKind },
        result,
      )
    ).trim();
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

async function askUserTool(
  _input: {
    question: string;
    choices: Array<{ label: string; value: string }>;
    mode: "single" | "multiple";
    allow_freeform: boolean;
    freeform_label: string;
  },
  { toolCallId }: { toolCallId: string },
) {
  const answer = await askUserHook.create({ token: toolCallId });
  return { ok: true, ...answer };
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
      execute: askUserTool,
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

async function finishWorkflowStream(writable: WritableStream<any>): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try {
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
  });

  try {
    const streamResult = await agent.stream({
      messages: input.modelMessages,
      writable,
      stopWhen: stepCountAtLeast(MAX_AGENT_STEPS),
      sendFinish: false,
      preventClose: true,
      onError: (event) => {
        console.error("[chat-agent] WorkflowAgent stream error", event.error);
      },
    });
    const parts = stepsToAssistantParts(streamResult.steps);
    const lastStep = streamResult.steps.at(-1);
    const finalText = lastStep?.text ?? "";
    const totalTokens = streamResult.steps.reduce(
      (sum, step) => sum + (step.usage?.totalTokens ?? 0),
      0,
    );
    await persistWorkflowCompletion({
      runId: input.runId,
      conversationId: input.conversationId,
      parts,
      totalTokens,
    });
    await finishWorkflowStream(writable);
    return { text: finalText };
  } catch (err) {
    console.error("[chat-agent] runChatAgent failed", err);
    await failWorkflowRun({ runId: input.runId, error: err });
    throw err;
  }
}
