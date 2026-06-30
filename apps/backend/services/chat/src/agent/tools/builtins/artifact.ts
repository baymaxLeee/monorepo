import { tool } from "ai";
import { z } from "zod";

import { editFileTool, writeFileTool } from "../../artifacts/generator.js";
import { inspectArtifactHtml, validateArtifactHtml } from "../../artifacts/compiler.js";
import { getDocument, getDocumentSource } from "../../../clients/knowledge.js";
import { artifactToolContextSchema, type ArtifactToolContext } from "../context.js";

async function inspectArtifact(
  input: { command: "validate_html" | "inspect_layout"; file_id: string },
  { context }: { context: ArtifactToolContext },
) {
  try {
    const document = await getDocument(context.userId, input.file_id);
    if (document.conversation_id !== context.conversationId) {
      return { ok: false, error: `file ${input.file_id} is not attached to this conversation` };
    }
    const source = await getDocumentSource(context.userId, input.file_id);
    if (source.mimeType !== "text/html") {
      return { ok: false, error: `${input.command} only supports HTML files` };
    }
    const html = new TextDecoder().decode(source.bytes);
    if (input.command === "validate_html") {
      const validation = validateArtifactHtml(html);
      return {
        ok: validation.ok,
        command: input.command,
        file_id: input.file_id,
        structural_errors: validation.structural_errors,
        broken_internal_links: validation.broken_internal_links,
      };
    }
    return {
      ok: true,
      command: input.command,
      file_id: input.file_id,
      ...inspectArtifactHtml(html),
    };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

export function createArtifactTools() {
  return {
    write_file: tool({
      description:
        "Generate and persist a new Markdown or HTML file from a compact brief. HTML is planned and generated in bounded concurrent blocks; the artifact model owns its theme and layout.",
      inputSchema: z.object({
        title: z.string().min(1).max(120).describe("Human-readable artifact title."),
        filename: z.string().min(1).max(160).describe("Filename including .html or .md extension."),
        kind: z.enum(["html", "markdown"]).describe("Output file format."),
        mode: z
          .enum(["document", "presentation", "dashboard"])
          .default("document")
          .describe("Content intent only. It affects outlining and default page count, never theme, color scheme, or layout."),
        brief: z.string().min(1).max(20_000).describe("Content and visual requirements. Preserve explicit user design requests."),
        page_count: z.number().int().min(1).max(100).optional().describe("Requested number of generated blocks or pages."),
        resume_job_id: z.string().min(1).max(32).optional(),
      }),
      contextSchema: artifactToolContextSchema,
      execute: writeFileTool,
    }),
    edit_file: tool({
      description:
        "Edit an existing generated file from a change brief. HTML block content, CSS, theme, layout, and charts may all be revised.",
      inputSchema: z.object({
        document_id: z.string().min(1).max(32),
        title: z.string().min(1).max(120).optional(),
        filename: z.string().min(1).max(160).optional(),
        brief: z.string().min(1).max(12_000),
        block_ids: z.array(z.string().regex(/^page-[1-9]\d*$/)).max(100).optional(),
      }),
      contextSchema: artifactToolContextSchema,
      execute: editFileTool,
    }),
    run_command: tool({
      description:
        "Inspect a stored HTML artifact. validate_html is a correctness gate; inspect_layout reports pages, charts, invalid charts, broken links, and failed blocks.",
      inputSchema: z.object({
        command: z.enum(["validate_html", "inspect_layout"]),
        file_id: z.string().min(1).max(32),
      }),
      contextSchema: artifactToolContextSchema,
      execute: inspectArtifact,
    }),
  };
}
