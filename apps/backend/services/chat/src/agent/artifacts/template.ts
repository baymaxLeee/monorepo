// Static artifact prompts and browser runtime templates live here.
import { z } from "zod";

export type ArtifactKind = "html" | "markdown";

export const ECHARTS_CDN_URL = "https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js";
export const ECHARTS_CDN_INTEGRITY =
  "sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD";
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
].join("; ");
export const ARTIFACT_ERROR_BOUNDARY = [
  "  <script>",
  "    window.addEventListener('error', function (event) {",
  "      if (document.getElementById('__artifact_runtime_error__')) return;",
  "      const panel = document.createElement('pre');",
  "      panel.id = '__artifact_runtime_error__';",
  "      panel.style.cssText = 'position:fixed;inset:auto 16px 16px;z-index:2147483647;max-height:40vh;overflow:auto;margin:0;padding:12px;border:1px solid #fecaca;border-radius:8px;background:#fff1f2;color:#9f1239;font:12px/1.5 monospace;white-space:pre-wrap';",
  "      panel.textContent = 'Artifact script error: ' + (event.message || 'Unknown runtime error');",
  "      document.body.appendChild(panel);",
  "    });",
  "  </script>",
].join("\n");

const ECHARTS_CDN_TAG = `  <script src="${ECHARTS_CDN_URL}" integrity="${ECHARTS_CDN_INTEGRITY}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;

/**
 * Inline `<head>` runtime shared by every artifact HTML document: CSP meta,
 * the global error boundary, and (when charts are present) the pinned ECharts
 * CDN tag. Marked with `data-chat-artifact-runtime` so it is injected once.
 */
export function buildArtifactRuntimeHead(options: { usesEcharts: boolean }): string {
  return [
    `  <meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}" data-chat-artifact-runtime="true" />`,
    ARTIFACT_ERROR_BOUNDARY,
    options.usesEcharts ? ECHARTS_CDN_TAG : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Hydration script for compiled multi-block artifacts: every chart is emitted
 * by block generation as a `<div data-chart-option="{escaped JSON}">`. This
 * inline script (trusted, compile-injected — blocks never emit raw JS) reads
 * each option, initializes ECharts, and keeps it responsive. Missing runtime or
 * invalid option degrades to visible text instead of an empty box.
 */
export function buildChartHydrationScript(): string {
  return [
    "  <script>",
    "    (function () {",
    "      function hydrate() {",
    "        var nodes = document.querySelectorAll('[data-chart-option]');",
    "        if (!nodes.length) return;",
    "        if (!window.echarts) {",
    "          nodes.forEach(function (el) { el.textContent = '图表运行时不可用'; });",
    "          return;",
    "        }",
    "        nodes.forEach(function (el) {",
    "          var raw = el.getAttribute('data-chart-option');",
    "          try {",
    "            var option = JSON.parse(raw);",
    "            if (!el.style.minHeight) el.style.minHeight = '360px';",
    "            var chart = window.echarts.init(el);",
    "            chart.setOption(option);",
    "            if (typeof ResizeObserver !== 'undefined') {",
    "              new ResizeObserver(function () { chart.resize(); }).observe(el);",
    "            } else {",
    "              window.addEventListener('resize', function () { chart.resize(); });",
    "            }",
    "          } catch (err) {",
    "            el.textContent = '图表渲染失败: ' + (err && err.message ? err.message : String(err));",
    "          }",
    "        });",
    "      }",
    "      if (document.readyState === 'loading') {",
    "        document.addEventListener('DOMContentLoaded', hydrate);",
    "      } else {",
    "        hydrate();",
    "      }",
    "    })();",
    "  </script>",
  ].join("\n");
}

/**
 * Trusted intra-document navigation for the sandboxed preview. The artifact is
 * rendered in an `srcdoc` iframe with `allow-scripts` but WITHOUT
 * `allow-same-origin`, so its base URL is `about:srcdoc` and a bare `#id` link
 * resolves against the PARENT document — clicking a directory link tries to
 * load the host app (localhost:3000) and is blocked (403/ERR_ABORTED). We keep
 * the sandbox tight and instead intercept same-document fragment clicks here
 * (compile-injected, trusted; blocks never emit JS) and scroll to the target.
 */
export function buildArtifactNavScript(): string {
  return [
    "  <script>",
    "    (function () {",
    "      function targetFor(hash) {",
    "        if (!hash || hash.charAt(0) !== '#' || hash.length < 2) return null;",
    "        var id = decodeURIComponent(hash.slice(1));",
    "        return document.getElementById(id) || document.querySelector('[name=\"' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '\"]');",
    "      }",
    "      document.addEventListener('click', function (event) {",
    "        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;",
    "        var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;",
    "        if (!anchor) return;",
    "        var href = anchor.getAttribute('href') || '';",
    "        if (href.charAt(0) !== '#') return;",
    "        var el = targetFor(href);",
    "        event.preventDefault();",
    "        if (el) {",
    "          el.scrollIntoView({ behavior: 'smooth', block: 'start' });",
    "          if (typeof el.focus === 'function') { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }",
    "        }",
    "      });",
    "    })();",
    "  </script>",
  ].join("\n");
}

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
  return injectArtifactRuntime([
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
  ].join("\n"));
}

function injectArtifactRuntime(content: string): string {
  if (content.includes('data-chat-artifact-runtime="true"')) return content;
  const usesEcharts = /\becharts\b/i.test(content);
  const runtime = buildArtifactRuntimeHead({ usesEcharts });

  const head = content.match(/<head\b[^>]*>/i);
  if (head?.index !== undefined) {
    const insertAt = head.index + head[0].length;
    return `${content.slice(0, insertAt)}\n${runtime}${content.slice(insertAt)}`;
  }
  return content.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n<head>\n${runtime}\n</head>`);
}

export function normalizeArtifactContent(kind: ArtifactKind, raw: string): string {
  let content = decodeArtifactEscapes(raw);
  content = stripMarkdownFences(content);

  if (kind !== "html") return content;

  content = extractPrimaryHtmlDocument(content);
  const lowered = content.toLowerCase();
  if (lowered.startsWith("<!doctype html") || lowered.startsWith("<html")) {
    return injectArtifactRuntime(content);
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
