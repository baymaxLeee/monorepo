export type ArtifactKind = "html" | "markdown";

export const ECHARTS_RUNTIME_URL = "/runtime/echarts/6.1.0/echarts.simple.min.js";
export const ECHARTS_RUNTIME_INTEGRITY =
  "sha384-tceyq+iTlugaZ6vut4CtUPLeu5PA081dcSvhme2LINBzh+11ILKQmEeRvpDnv9Q7";
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
].join("; ");
// "ResizeObserver loop ..." is a benign browser notification, not a real error.
export const ARTIFACT_ERROR_BOUNDARY = [
  "  <script>",
  "    window.addEventListener('error', function (event) {",
  "      const message = (event && event.message) || (event && event.error && event.error.message) || '';",
  "      if (message.indexOf('ResizeObserver loop') === 0) return;",
  "      const isRealError = !!(event && (event.error || (event.message && event.target === window)));",
  "      if (!isRealError) return;",
  "      if (document.getElementById('__artifact_runtime_error__')) return;",
  "      const panel = document.createElement('pre');",
  "      panel.id = '__artifact_runtime_error__';",
  "      panel.style.cssText = 'position:fixed;inset:auto 16px 16px;z-index:2147483647;max-height:40vh;overflow:auto;margin:0;padding:12px;border:1px solid #fecaca;border-radius:8px;background:#fff1f2;color:#9f1239;font:12px/1.5 monospace;white-space:pre-wrap';",
  "      panel.textContent = 'Artifact script error: ' + (message || 'Unknown runtime error');",
  "      document.body.appendChild(panel);",
  "    });",
  "  </script>",
].join("\n");

const ECHARTS_RUNTIME_TAG = `  <script src="${ECHARTS_RUNTIME_URL}" integrity="${ECHARTS_RUNTIME_INTEGRITY}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;

export function buildArtifactRuntimeHead(options: { usesEcharts: boolean }): string {
  return [
    `  <meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}" data-chat-artifact-runtime="true" />`,
    ARTIFACT_ERROR_BOUNDARY,
    options.usesEcharts ? ECHARTS_RUNTIME_TAG : "",
  ]
    .filter(Boolean)
    .join("\n");
}

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

export function safeFilename(filename: string): string {
  return (
    filename
      .replace(/[\\/:"*?<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "artifact.md"
  );
}
