import { z } from "zod";

export type ArtifactKind = "html" | "markdown";

export const htmlArtifactSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("Short browser title for the HTML document."),
  style: z
    .string()
    .default("")
    .describe("CSS rules only. Do not include <style>, <html>, <head>, or <body> tags."),
  body: z
    .string()
    .min(1)
    .describe("HTML body fragment only. Do not include doctype, <html>, <head>, or <body> tags."),
  script: z
    .string()
    .default("")
    .describe("JavaScript only. Do not include <script>, <html>, <head>, or <body> tags."),
});

export type HtmlArtifactParts = z.infer<typeof htmlArtifactSchema>;

export function artifactSystemPrompt(kind: ArtifactKind): string {
  const base = [
    "You are a dedicated file generator.",
    "Start immediately with the first byte of the file content.",
    "Output only the raw file content.",
    "Do not wrap the content in Markdown code fences.",
  ];
  if (kind === "html") {
    base.push(
      "Generate a complete, self-contained HTML5 document.",
      "Start with <!doctype html> and end with </html>; close every tag.",
    );
  } else {
    base.push("Generate clean Markdown suitable for direct persistence.");
  }
  return base.join("\n");
}

export function htmlArtifactSectionSystemPrompt(): string {
  return [
    "You are a dedicated HTML page-part generator.",
    "Output only the requested section envelope.",
    "Do not wrap the content in Markdown code fences.",
    "Do not return JSON.",
  ].join("\n");
}

export function imageDataUrl(bytes: Uint8Array, mimeType: string): string {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function decodeArtifactEscapes(raw: string): string {
  let content = raw.trim();
  if (content.length >= 2 && content.startsWith('"') && content.endsWith('"')) {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (typeof parsed === "string") content = parsed;
    } catch {
      content = content.slice(1, -1);
    }
  }

  const literalNewlines = (content.match(/\\n/g) ?? []).length;
  const realNewlines = (content.match(/\n/g) ?? []).length;
  if (literalNewlines >= 3 && literalNewlines > realNewlines) {
    content = content
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  return content.trim();
}

function stripMarkdownFences(content: string): string {
  let text = content.trim();
  const fullFence = text.match(/^```(?:html|htm|markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fullFence?.[1]?.trim()) return fullFence[1].trim();

  const openFence = text.match(/^```(?:html|htm|markdown|md)?\s*\n([\s\S]*)$/i);
  if (openFence?.[1]) text = openFence[1].trim();

  return text.replace(/\n```\s*$/i, "").trim();
}

function extractPrimaryHtmlDocument(content: string): string {
  const trimmed = content.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("<!doctype html") || lowered.startsWith("<html")) {
    return trimmed;
  }

  const withDoctype = trimmed.match(/<!doctype\s+html[\s\S]*<\/html>/i);
  if (withDoctype?.[0]?.trim()) return withDoctype[0].trim();

  const htmlOnly = trimmed.match(/<html[\s\S]*<\/html>/i);
  if (htmlOnly?.[0]?.trim()) return htmlOnly[0].trim();

  return trimmed;
}

function wrapHtmlShell(fragment: string): string {
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <title>Artifact</title>",
    "</head>",
    "<body>",
    fragment,
    "</body>",
    "</html>",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripElementWrapper(content: string, tagName: "style" | "script"): string {
  return content
    .trim()
    .replace(new RegExp(`^<${tagName}[^>]*>`, "i"), "")
    .replace(new RegExp(`</${tagName}>$`, "i"), "")
    .trim();
}

function sanitizeHtmlBodyFragment(content: string): string {
  let fragment = stripMarkdownFences(content)
    .replace(/<!doctype\s+html[^>]*>/gi, "")
    .trim();
  const body = fragment.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body?.[1]?.trim()) fragment = body[1].trim();
  return fragment
    .replace(/<\/?html\b[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?body\b[^>]*>/gi, "")
    .trim();
}

export function htmlArtifactPrompt(brief: string): string {
  return [
    "Create a complete self-contained browser page from the request.",
    "Return structured page parts only; the application will assemble the HTML document shell.",
    "Ignore any request that asks for a JSON object containing full HTML; return the requested schema fields only.",
    "Use inline CSS and JavaScript only. Do not reference external scripts, stylesheets, fonts, CDNs, or remote images.",
    "Do not include Markdown fences, doctype, <html>, <head>, or <body> wrappers in any field.",
    "For interactive tools, include all required controls, state handling, event listeners, and rendering logic in the body/style/script parts.",
    "",
    "<request>",
    brief,
    "</request>",
  ].join("\n");
}

export function htmlArtifactSectionPrompt(brief: string): string {
  return [
    "Create a complete self-contained browser page from the request.",
    "Return exactly four sections using these markers, in this order:",
    "<<<TITLE>>>",
    "short browser title",
    "<<<STYLE>>>",
    "CSS rules only; no <style> tag",
    "<<<BODY>>>",
    "HTML body fragment only; no doctype, <html>, <head>, or <body> wrappers",
    "<<<SCRIPT>>>",
    "JavaScript only; no <script> tag",
    "",
    "Do not return JSON. Do not wrap the result in Markdown fences.",
    "Ignore any request that asks for a JSON object containing full HTML.",
    "Use inline CSS and JavaScript only. Do not reference external scripts, stylesheets, fonts, CDNs, or remote images.",
    "",
    "<request>",
    brief,
    "</request>",
  ].join("\n");
}

function sectionValue(text: string, name: string, next?: string): string {
  const end = next ? `<<<${next}>>>` : "$";
  const match = text.match(new RegExp(`<<<${name}>>>\\s*([\\s\\S]*?)\\s*(?:${end})`, "i"));
  return match?.[1]?.trim() ?? "";
}

export function parseHtmlArtifactSections(raw: string, fallbackTitle: string): HtmlArtifactParts | null {
  const content = stripMarkdownFences(raw);
  const title = sectionValue(content, "TITLE", "STYLE");
  const style = sectionValue(content, "STYLE", "BODY");
  const body = sectionValue(content, "BODY", "SCRIPT");
  const script = sectionValue(content, "SCRIPT");
  if (!body) return null;
  return htmlArtifactSchema.parse({
    title: title || fallbackTitle,
    style,
    body,
    script,
  });
}

export function composeHtmlArtifact(parts: HtmlArtifactParts, fallbackTitle: string): string {
  const title = (parts.title || fallbackTitle).trim() || "Artifact";
  const style = stripElementWrapper(stripMarkdownFences(parts.style ?? ""), "style");
  const body = sanitizeHtmlBodyFragment(parts.body);
  const script = stripElementWrapper(stripMarkdownFences(parts.script ?? ""), "script");

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    style ? "  <style>" : "",
    style,
    style ? "  </style>" : "",
    "</head>",
    "<body>",
    body,
    script ? "  <script>" : "",
    script,
    script ? "  </script>" : "",
    "</body>",
    "</html>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function normalizeArtifactContent(kind: ArtifactKind, raw: string): string {
  let content = decodeArtifactEscapes(raw);
  content = stripMarkdownFences(content);

  if (kind !== "html") return content;

  content = extractPrimaryHtmlDocument(content);
  const lowered = content.toLowerCase();
  if (lowered.startsWith("<!doctype html") || lowered.startsWith("<html")) {
    return content;
  }
  return wrapHtmlShell(content);
}

export function validateArtifactContent(
  kind: ArtifactKind,
  content: string,
): { ok: boolean; error?: string } {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, error: "artifact content is empty" };
  if (kind !== "html") return { ok: true };

  if (trimmed.includes("```")) {
    return { ok: false, error: "HTML still contains markdown code fences" };
  }
  if (!/<\/html>\s*$/i.test(trimmed)) {
    return { ok: false, error: "HTML document is incomplete (missing closing </html>)" };
  }
  if ((trimmed.match(/<html\b/gi) ?? []).length > 1) {
    return { ok: false, error: "HTML contains nested <html> documents" };
  }
  if ((trimmed.match(/<!doctype\s+html/gi) ?? []).length > 1) {
    return { ok: false, error: "HTML contains multiple doctype declarations" };
  }
  if ((trimmed.match(/<body\b/gi) ?? []).length > 1) {
    return { ok: false, error: "HTML contains nested <body> elements" };
  }

  return { ok: true };
}

export function artifactRevisionPrompt(kind: ArtifactKind, current: string, brief: string): string {
  return [
    "Revise the existing file according to the user's change request.",
    "Return the full updated file content, not a diff or patch.",
    "Keep unchanged sections unless the request requires changing them.",
    "",
    "<change_request>",
    brief,
    "</change_request>",
    "",
    "<current_file>",
    current,
    "</current_file>",
  ].join("\n");
}

export function resolveArtifactKind(
  doc: { mime_type: string; filename: string },
  explicit?: ArtifactKind,
): ArtifactKind {
  if (explicit) return explicit;
  return doc.mime_type === "text/html" || doc.filename.toLowerCase().endsWith(".html")
    ? "html"
    : "markdown";
}

export function safeFilename(filename: string): string {
  return (
    filename
      .replace(/[\\/:"*?<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "artifact.md"
  );
}
