import { createHash } from "node:crypto";
import {
  extractJsonMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from "ai";

import { getProvider } from "../clients/admin.js";
import {
  createArtifact,
  getDocument,
  listArtifactBlocks,
  publishArtifactRevision,
  reserveArtifactGeneration,
  saveArtifactBlock,
  saveArtifactPlan,
  updateArtifact,
} from "../clients/knowledge.js";

import {
  artifactRevisionPrompt,
  artifactSystemPrompt,
  normalizeArtifactContent,
  resolveArtifactKind,
  safeFilename,
  type ArtifactKind,
  validateArtifactContent,
} from "./agent-artifacts.js";
import {
  ARTIFACT_GENERATION_TIMEOUT,
  ARTIFACT_CHUNKED_REVISION_THRESHOLD,
  ARTIFACT_REVISION_CHUNK_CHARS,
} from "./agent-config.js";
import { createProviderModel } from "./agent-provider.js";
import type { ToolContext } from "./agent-types.js";
import { compileArtifactHtml, sanitizeArtifactPart } from "./artifact-compiler.js";

type ArtifactPartInput = {
  planItemId: string;
  partId: string;
  type: string;
  title: string;
};

export async function beginArtifactTool(
  input: {
    planId: string;
    title: string;
    filename: string;
    mode: "document" | "presentation" | "dashboard";
    theme: { preset: string; accent: string };
    parts: ArtifactPartInput[];
  },
  { context, toolCallId }: { context: ToolContext; toolCallId: string },
) {
  const filename = safeFilename(input.filename);
  const generation = await reserveArtifactGeneration({
    userId: context.userId,
    conversationId: context.conversationId,
    title: input.title,
    filename,
    mode: input.mode,
    brief: `Plan ${input.planId}`,
    idempotencyKey: toolCallId,
  });
  await saveArtifactPlan({
    userId: context.userId,
    generationId: generation.id,
    manifest: { schemaVersion: 1, planId: input.planId, mode: input.mode, theme: input.theme, parts: input.parts },
    blocks: input.parts.map((part) => ({ id: part.partId, type: part.type, brief: part.title })),
  });
  return {
    ok: true,
    generation_id: generation.id,
    document_id: generation.document_id,
    title: input.title,
    filename,
    mode: input.mode,
    parts_total: input.parts.length,
  };
}

export async function writeArtifactPartTool(
  input: {
    generationId: string;
    planItemId: string;
    partId: string;
    type: string;
    title: string;
    content: string;
  },
  { context }: { context: ToolContext },
) {
  const html = sanitizeArtifactPart(input.content);
  if (!html) return { ok: false, error: "artifact part is empty", plan_item_id: input.planItemId };
  await saveArtifactBlock({
    userId: context.userId,
    generationId: input.generationId,
    blockId: input.partId,
    content: JSON.stringify({ title: input.title, html }),
  });
  return {
    ok: true,
    generation_id: input.generationId,
    plan_item_id: input.planItemId,
    part_id: input.partId,
    chars: html.length,
    sha256: createHash("sha256").update(html).digest("hex"),
  };
}

export async function publishArtifactTool(
  input: {
    generationId: string;
    title: string;
    filename: string;
    mode: "document" | "presentation" | "dashboard";
    theme: { preset: string; accent: string };
    parts: Array<{ id: string; type: string; title: string }>;
  },
  { context }: { context: ToolContext },
) {
  const stored = await listArtifactBlocks(context.userId, input.generationId);
  const compiled = compileArtifactHtml({
    title: input.title,
    mode: input.mode,
    theme: input.theme,
    parts: input.parts,
    stored,
  });
  const published = await publishArtifactRevision({
    userId: context.userId,
    generationId: input.generationId,
    compiledHtml: compiled.html,
  });
  return {
    ok: true,
    status: "persisted",
    document_id: published.document_id,
    revision_id: published.revision_id,
    title: published.title,
    filename: published.filename,
    kind: "html" as const,
    total_chars: published.total_chars,
    parts_ok: compiled.partsOk,
    parts_failed: compiled.partsFailed,
  };
}

export async function buildArtifactTextModel(userId: string, providerId: string) {
  const provider = await getProvider(userId, providerId);
  const model = createProviderModel(provider, { disableReasoning: true });
  return {
    model,
    structuredModel: wrapLanguageModel({ model, middleware: extractJsonMiddleware() }),
    generateText,
    Output,
    streamText,
  };
}

async function collectArtifactContent(
  result: { textStream: AsyncIterable<string> },
): Promise<string> {
  let raw = "";
  for await (const delta of result.textStream) raw += delta;
  return raw;
}

function splitRevisionChunks(content: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + ARTIFACT_REVISION_CHUNK_CHARS, content.length);
    if (end < content.length) {
      const newline = content.lastIndexOf("\n", end);
      if (newline > start + ARTIFACT_REVISION_CHUNK_CHARS / 2) end = newline + 1;
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

async function generateChunkedRevision(input: {
  current: string;
  brief: string;
  toolCallId: string;
  meta: { title: string; filename: string; kind: ArtifactKind };
  tools: Awaited<ReturnType<typeof buildArtifactTextModel>>;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const chunks = splitRevisionChunks(input.current);
  const timeoutSignal = AbortSignal.timeout(ARTIFACT_GENERATION_TIMEOUT.totalMs);
  const abortSignal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, timeoutSignal])
    : timeoutSignal;
  let revised = "";
  for (const [index, chunk] of chunks.entries()) {
    const result = input.tools.streamText({
      model: input.tools.model,
      instructions: [
        "You revise one bounded fragment of a larger file.",
        "Apply the change request only when it affects this fragment.",
        "Preserve the fragment byte-for-byte when it is unrelated.",
        "Return only the complete revised fragment, without fences or commentary.",
        "Do not add document wrappers merely because this fragment is HTML.",
      ].join("\n"),
      prompt: [
        `<change_request>${input.brief}</change_request>`,
        `<fragment index="${index + 1}" total="${chunks.length}">`,
        chunk,
        "</fragment>",
      ].join("\n\n"),
      timeout: ARTIFACT_GENERATION_TIMEOUT,
      abortSignal,
    });
    let next = "";
    for await (const delta of result.textStream) next += delta;
    revised += next || chunk;
  }
  return revised;
}

export async function createArtifactTool(
  input: { title: string; filename: string; kind: "markdown"; mode?: "document" | "presentation" | "dashboard"; brief: string },
  { context, toolCallId, abortSignal }: { context: ToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  const filename = safeFilename(input.filename);
  try {
    const artifactTools = await buildArtifactTextModel(context.userId, context.providerId);
    const result = artifactTools.streamText({
      model: artifactTools.model,
      instructions: artifactSystemPrompt(input.kind),
      prompt: input.brief,
      timeout: ARTIFACT_GENERATION_TIMEOUT,
      abortSignal,
    });
    const raw = (await collectArtifactContent(result)).trim();
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
      mimeType: "text/markdown",
      idempotencyKey: toolCallId,
    });
    return { ok: true, status: "persisted", document_id: doc.id, title: doc.title, filename: doc.filename, kind: input.kind, total_chars: content.length };
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    console.error("[chat-agent] create artifact failed", {
      toolCallId,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

export async function updateArtifactTool(
  input: { document_id: string; title?: string; filename?: string; kind?: ArtifactKind; brief: string },
  { context, toolCallId, abortSignal }: { context: ToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  try {
    const artifactTools = await buildArtifactTextModel(context.userId, context.providerId);
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") return { ok: false, error: `document ${input.document_id} is not an artifact` };
    const artifactKind = resolveArtifactKind(current, input.kind);
    const title = input.title ?? current.title;
    const filename = input.filename ? safeFilename(input.filename) : current.filename;
    const currentContent = current.content_md ?? "";
    let content: string;
    if (currentContent.length > ARTIFACT_CHUNKED_REVISION_THRESHOLD) {
      content = await generateChunkedRevision({
        current: currentContent,
        brief: input.brief,
        toolCallId,
        meta: { title, filename, kind: artifactKind },
        tools: artifactTools,
        abortSignal,
      });
      content = normalizeArtifactContent(artifactKind, content);
    } else {
      const result = artifactTools.streamText({
        model: artifactTools.model,
        instructions: artifactSystemPrompt(artifactKind),
        prompt: artifactRevisionPrompt(artifactKind, currentContent, input.brief),
        timeout: ARTIFACT_GENERATION_TIMEOUT,
        abortSignal,
      });
      const raw = (await collectArtifactContent(result)).trim();
      if (!raw) return { ok: false, error: "artifact revision returned empty content" };
      content = normalizeArtifactContent(artifactKind, raw);
    }
    const validation = validateArtifactContent(artifactKind, content);
    if (!validation.ok) return { ok: false, error: validation.error ?? "artifact validation failed" };
    const doc = await updateArtifact({
      userId: context.userId,
      documentId: input.document_id,
      title: input.title,
      filename,
      content,
      mimeType: artifactKind === "html" ? "text/html" : "text/markdown",
      expectedUpdatedAt: current.updated_at,
    });
    return { ok: true, status: "persisted", document_id: doc.id, title: doc.title, filename: doc.filename, kind: artifactKind, total_chars: content.length };
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    console.error("[chat-agent] update artifact failed", {
      toolCallId,
      kind: input.kind,
      documentId: input.document_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: String(err).slice(0, 500) };
  }
}
