export type ArtifactKind = "html" | "markdown";

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
