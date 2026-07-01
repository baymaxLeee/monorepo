// Markdown-only prompts and content normalization. The HTML runtime shell
// (CSP, ECharts CDN, hydration/nav/error-boundary scripts) moved to the
// executor service — see its src/artifacts/template.ts — since compilation
// now happens there.
export type ArtifactKind = "markdown";

export function artifactSystemPrompt(_kind: ArtifactKind): string {
  return [
    "You are a dedicated file generator.",
    "Start immediately with the first byte of the file content.",
    "Output only the raw file content.",
    "Do not wrap the content in Markdown code fences.",
    "Generate clean Markdown suitable for direct persistence.",
  ].join("\n");
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
  const fullFence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fullFence?.[1]?.trim()) return fullFence[1].trim();

  const openFence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*)$/i);
  if (openFence?.[1]) text = openFence[1].trim();

  return text.replace(/\n```\s*$/i, "").trim();
}

export function normalizeArtifactContent(_kind: ArtifactKind, raw: string): string {
  let content = decodeArtifactEscapes(raw);
  content = stripMarkdownFences(content);
  return content;
}

export function validateArtifactContent(
  _kind: ArtifactKind,
  content: string,
): { ok: boolean; error?: string } {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, error: "artifact content is empty" };
  return { ok: true };
}

export function artifactRevisionPrompt(_kind: ArtifactKind, current: string, brief: string): string {
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

export function safeFilename(filename: string): string {
  return (
    filename
      .replace(/[\\/:"*?<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "artifact.md"
  );
}
