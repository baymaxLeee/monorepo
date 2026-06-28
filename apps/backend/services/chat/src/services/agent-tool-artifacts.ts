import { getWritable } from "workflow";

import {
  artifactRevisionPrompt,
  artifactSystemPrompt,
  composeHtmlArtifact,
  htmlArtifactPrompt,
  htmlArtifactSchema,
  htmlArtifactSectionPrompt,
  htmlArtifactSectionSystemPrompt,
  normalizeArtifactContent,
  parseHtmlArtifactSections,
  resolveArtifactKind,
  safeFilename,
  type ArtifactKind,
  validateArtifactContent,
} from "./agent-artifacts.js";
import {
  ARTIFACT_GENERATION_TIMEOUT,
  ARTIFACT_CHUNKED_REVISION_THRESHOLD,
  ARTIFACT_PREVIEW_MAX_CHARS,
  ARTIFACT_REVISION_CHUNK_CHARS,
  ARTIFACT_STREAM_MIN_DELTA_CHARS,
  ARTIFACT_STREAM_NAMESPACE,
} from "./agent-config.js";
import { createProviderModel } from "./agent-provider.js";
import type { ArtifactStreamData, ToolContext } from "./agent-types.js";

async function buildArtifactTextModel(userId: string, providerId: string) {
  const [
    { getProvider },
    { extractJsonMiddleware, generateText, NoObjectGeneratedError, Output, streamText, wrapLanguageModel },
  ] = await Promise.all([import("../clients/admin.js"), import("ai")]);
  const provider = await getProvider(userId, providerId);
  const model = createProviderModel(provider, { disableReasoning: true });
  return {
    model,
    structuredModel: wrapLanguageModel({ model, middleware: extractJsonMiddleware() }),
    generateText,
    NoObjectGeneratedError,
    Output,
    streamText,
  };
}

function artifactPreview(content: string): string {
  return content.slice(-ARTIFACT_PREVIEW_MAX_CHARS);
}

async function writeArtifactSnapshot(
  toolCallId: string,
  meta: { title: string; filename: string; kind: ArtifactKind },
  status: ArtifactStreamData["status"],
  content: string,
  documentId?: string,
) {
  try {
    const writable = getWritable<{ type: string; id: string; data: ArtifactStreamData }>({
      namespace: ARTIFACT_STREAM_NAMESPACE,
    });
    const writer = writable.getWriter();
    try {
      await writer.write({
        type: "data-artifact",
        id: toolCallId,
        data: {
          toolCallId,
          status,
          ...meta,
          preview: artifactPreview(content),
          generated_chars: content.length,
          document_id: documentId,
        },
      });
    } finally {
      writer.releaseLock();
    }
  } catch (err) {
    console.error("[chat-agent] artifact stream write failed", err);
  }
}

async function streamArtifactContent(
  toolCallId: string,
  meta: { title: string; filename: string; kind: ArtifactKind },
  result: { textStream: AsyncIterable<string> },
): Promise<string> {
  let raw = "";
  let lastSentLength = 0;
  for await (const delta of result.textStream) {
    raw += delta;
    if (raw.length - lastSentLength >= ARTIFACT_STREAM_MIN_DELTA_CHARS) {
      lastSentLength = raw.length;
      await writeArtifactSnapshot(toolCallId, meta, "generating", raw);
    }
  }
  if (raw.length !== lastSentLength) {
    await writeArtifactSnapshot(toolCallId, meta, "generating", raw);
  }
  return raw;
}

async function generateHtmlArtifactContent(
  input: { title: string; brief: string },
  tools: Awaited<ReturnType<typeof buildArtifactTextModel>>,
): Promise<string> {
  try {
    const result = await tools.generateText({
      model: tools.structuredModel,
      output: tools.Output.object({ schema: htmlArtifactSchema }),
      prompt: htmlArtifactPrompt(input.brief),
      maxOutputTokens: 20_000,
      timeout: ARTIFACT_GENERATION_TIMEOUT,
    });
    return composeHtmlArtifact(result.output, input.title);
  } catch (err) {
    const parsed =
      tools.NoObjectGeneratedError.isInstance(err) && err.text
        ? parseHtmlArtifactSections(err.text, input.title)
        : null;
    if (parsed) return composeHtmlArtifact(parsed, input.title);
    console.warn("[chat-agent] structured HTML artifact generation failed; using section fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const result = tools.streamText({
    model: tools.model,
    instructions: htmlArtifactSectionSystemPrompt(),
    prompt: htmlArtifactSectionPrompt(input.brief),
    maxOutputTokens: 20_000,
    timeout: ARTIFACT_GENERATION_TIMEOUT,
  });
  let raw = "";
  for await (const delta of result.textStream) raw += delta;
  raw = raw.trim();
  if (!raw) throw new Error("HTML artifact generation returned empty content");
  const parsed = parseHtmlArtifactSections(raw, input.title);
  return parsed ? composeHtmlArtifact(parsed, input.title) : normalizeArtifactContent("html", raw);
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
}): Promise<string> {
  const chunks = splitRevisionChunks(input.current);
  const abortSignal = AbortSignal.timeout(ARTIFACT_GENERATION_TIMEOUT.totalMs);
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
    await writeArtifactSnapshot(input.toolCallId, input.meta, "generating", revised);
  }
  return revised;
}

export async function createArtifactTool(
  input: { title: string; filename: string; kind: ArtifactKind; brief: string },
  { context, toolCallId }: { context: ToolContext; toolCallId: string },
) {
  "use step";
  const filename = safeFilename(input.filename);
  try {
    const [{ createArtifact }, artifactTools] = await Promise.all([
      import("../clients/knowledge.js"),
      buildArtifactTextModel(context.userId, context.providerId),
    ]);
    let content: string;
    if (input.kind === "html") {
      content = await generateHtmlArtifactContent(input, artifactTools);
      await writeArtifactSnapshot(toolCallId, { title: input.title, filename, kind: input.kind }, "generating", content);
    } else {
      const result = artifactTools.streamText({
        model: artifactTools.model,
        instructions: artifactSystemPrompt(input.kind),
        prompt: input.brief,
        timeout: ARTIFACT_GENERATION_TIMEOUT,
      });
      const raw = (await streamArtifactContent(toolCallId, { title: input.title, filename, kind: input.kind }, result)).trim();
      if (!raw) return { ok: false, error: "artifact generation returned empty content" };
      content = normalizeArtifactContent(input.kind, raw);
    }
    const validation = validateArtifactContent(input.kind, content);
    if (!validation.ok) return { ok: false, error: validation.error ?? "artifact validation failed" };
    const doc = await createArtifact({
      userId: context.userId,
      conversationId: context.conversationId,
      title: input.title,
      filename,
      content,
      mimeType: input.kind === "html" ? "text/html" : "text/markdown",
      idempotencyKey: toolCallId,
    });
    await writeArtifactSnapshot(toolCallId, { title: input.title, filename, kind: input.kind }, "persisted", content, doc.id);
    return { ok: true, status: "persisted", document_id: doc.id, title: doc.title, filename: doc.filename, kind: input.kind, total_chars: content.length };
  } catch (err) {
    console.error("[chat-agent] create artifact failed", {
      toolCallId,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    await writeArtifactSnapshot(toolCallId, { title: input.title, filename, kind: input.kind }, "error", "");
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

export async function updateArtifactTool(
  input: { document_id: string; title?: string; filename?: string; kind?: ArtifactKind; brief: string },
  { context, toolCallId }: { context: ToolContext; toolCallId: string },
) {
  "use step";
  try {
    const [{ getDocument, updateArtifact }, artifactTools] = await Promise.all([
      import("../clients/knowledge.js"),
      buildArtifactTextModel(context.userId, context.providerId),
    ]);
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
      });
      content = normalizeArtifactContent(artifactKind, content);
    } else if (artifactKind === "html") {
      content = await generateHtmlArtifactContent(
        { title, brief: artifactRevisionPrompt(artifactKind, currentContent, input.brief) },
        artifactTools,
      );
      await writeArtifactSnapshot(toolCallId, { title, filename, kind: artifactKind }, "generating", content);
    } else {
      const result = artifactTools.streamText({
        model: artifactTools.model,
        instructions: artifactSystemPrompt(artifactKind),
        prompt: artifactRevisionPrompt(artifactKind, currentContent, input.brief),
        timeout: ARTIFACT_GENERATION_TIMEOUT,
      });
      const raw = (await streamArtifactContent(toolCallId, { title, filename, kind: artifactKind }, result)).trim();
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
    await writeArtifactSnapshot(toolCallId, { title, filename, kind: artifactKind }, "persisted", content, doc.id);
    return { ok: true, status: "persisted", document_id: doc.id, title: doc.title, filename: doc.filename, kind: artifactKind, total_chars: content.length };
  } catch (err) {
    console.error("[chat-agent] update artifact failed", {
      toolCallId,
      kind: input.kind,
      documentId: input.document_id,
      error: err instanceof Error ? err.message : String(err),
    });
    await writeArtifactSnapshot(toolCallId, { title: input.title ?? "Artifact", filename: input.filename ? safeFilename(input.filename) : "artifact", kind: input.kind ?? "html" }, "error", "");
    return { ok: false, error: String(err).slice(0, 500) };
  }
}
