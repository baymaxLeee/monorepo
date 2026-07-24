export const ECHARTS_RUNTIME_URL = "/runtime/echarts/6.1.0/echarts.min.js";
export const ECHARTS_RUNTIME_CDN_URL =
  "https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js";
export const ECHARTS_RUNTIME_INTEGRITY =
  "sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD";
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
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

const ECHARTS_RUNTIME_LOADER = [
  "  <script>",
  "    window.__artifactEChartsReady = new Promise(function (resolve) {",
  `      var sources = [${JSON.stringify(ECHARTS_RUNTIME_URL)}, ${JSON.stringify(ECHARTS_RUNTIME_CDN_URL)}];`,
  "      function load(index) {",
  "        if (window.echarts) { resolve(true); return; }",
  "        if (index >= sources.length) { resolve(false); return; }",
  "        var script = document.createElement('script');",
  "        script.src = sources[index];",
  `        script.integrity = ${JSON.stringify(ECHARTS_RUNTIME_INTEGRITY)};`,
  "        script.crossOrigin = 'anonymous';",
  "        script.referrerPolicy = 'no-referrer';",
  "        script.onload = function () {",
  "          if (window.echarts) { resolve(true); } else { script.remove(); load(index + 1); }",
  "        };",
  "        script.onerror = function () { script.remove(); load(index + 1); };",
  "        document.head.appendChild(script);",
  "      }",
  "      load(0);",
  "    });",
  "  </script>",
].join("\n");

export function buildArtifactRuntimeHead(options: { usesEcharts: boolean }): string {
  return [
    `  <meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}" data-chat-artifact-runtime="true" />`,
    ARTIFACT_ERROR_BOUNDARY,
    options.usesEcharts ? ECHARTS_RUNTIME_LOADER : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChartHydrationScript(): string {
  return [
    "  <script>",
    "    (function () {",
    "      function showRuntimeUnavailable() {",
    "        document.querySelectorAll('[data-chart-option]').forEach(function (el) { el.textContent = '图表运行时不可用'; });",
    "      }",
    "      function hydrate() {",
    "        var nodes = document.querySelectorAll('[data-chart-option]');",
    "        if (!nodes.length) return;",
    "        if (!window.echarts) {",
    "          showRuntimeUnavailable();",
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
    "      function hydrateWhenReady() {",
    "        var ready = window.__artifactEChartsReady;",
    "        if (ready && typeof ready.then === 'function') {",
    "          ready.then(function (available) {",
    "            if (available) hydrate(); else showRuntimeUnavailable();",
    "          });",
    "        } else {",
    "          hydrate();",
    "        }",
    "      }",
    "      if (document.readyState === 'loading') {",
    "        document.addEventListener('DOMContentLoaded', hydrateWhenReady);",
    "      } else {",
    "        hydrateWhenReady();",
    "      }",
    "    })();",
    "  </script>",
  ].join("\n");
}

export function buildEChartsScriptExecutionScript(): string {
  return [
    "  <script>",
    "    (function () {",
    "      var sources = document.querySelectorAll('script[type=\"application/x-artifact-echarts\"]');",
    "      if (!sources.length) return;",
    "      function execute(available) {",
    "        sources.forEach(function (source) {",
    "          if (!available) { source.setAttribute('data-echarts-runtime-unavailable', 'true'); return; }",
    "          var script = document.createElement('script');",
    "          Array.from(source.attributes).forEach(function (attribute) {",
    "            if (attribute.name !== 'type' && attribute.name !== 'data-artifact-original-type') script.setAttribute(attribute.name, attribute.value);",
    "          });",
    "          var originalType = source.getAttribute('data-artifact-original-type');",
    "          if (originalType) script.type = originalType;",
    "          script.textContent = source.textContent || '';",
    "          source.replaceWith(script);",
    "        });",
    "      }",
    "      var ready = window.__artifactEChartsReady;",
    "      if (ready && typeof ready.then === 'function') ready.then(execute);",
    "      else execute(!!window.echarts);",
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
