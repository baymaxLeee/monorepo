import { buildArtifactNavScript, buildArtifactRuntimeHead, buildChartHydrationScript } from "./artifacts.js";
import sanitizeHtml from "sanitize-html";

export type ArtifactPartPlan = { id: string; type: string; title: string };

// The block generator must compose layout only from these compiler-owned
// classes (defined in artifactModeStyles) instead of inventing inline styles,
// which is what made independently generated blocks drift visually. Keep this
// list in sync with artifactModeStyles.
export const ARTIFACT_DESIGN_VOCABULARY = [
  "Layout: stack, stack-sm, stack-lg (vertical), row, cluster, split (horizontal), grid-2, grid-3, grid-4 (responsive columns), center.",
  "Surfaces: card, card--accent, callout (callout--info/success/warn).",
  "Emphasis: eyebrow (small caps kicker), lead (intro paragraph), badge (pill tag), muted (secondary text), divider.",
  "Data: kpi with kpi__value + kpi__label (big metric); table/thead/tbody for tabular data; timeline with timeline__item + timeline__time for chronologies.",
  "Charts: emit ONE empty <div data-chart=\"...\"></div> whose attribute is a tiny escaped-JSON spec. NEVER write ECharts or Chart.js option objects, <script>, <canvas>, or functions — the compiler builds and themes the real chart from your spec.",
].join("\n");

// The ONLY chart contract the model is taught. Kept tiny on purpose: the model
// supplies intent + data, the compiler (expandChartSpec) owns every ECharts
// structural and styling detail, so a malformed option is impossible.
export const ARTIFACT_CHART_SPEC = [
  "Chart spec fields: type (one of \"bar\" | \"line\" | \"area\" | \"pie\"), title (optional string), categories (string[] for bar/line/area; the x-axis labels), series (see below), optional stack:true, optional horizontal:true.",
  "series for bar/line/area: an array of {\"name\":string,\"data\":number[]} aligned with categories; for a single series you may pass a bare number[]: \"data\".",
  "series for pie: an array of {\"name\":string,\"value\":number}.",
  "Bar example: <div data-chart=\"{&quot;type&quot;:&quot;bar&quot;,&quot;title&quot;:&quot;销量&quot;,&quot;categories&quot;:[&quot;Q1&quot;,&quot;Q2&quot;],&quot;series&quot;:[{&quot;name&quot;:&quot;华东&quot;,&quot;data&quot;:[120,200]}]}\"></div>",
  "Pie example: <div data-chart=\"{&quot;type&quot;:&quot;pie&quot;,&quot;series&quot;:[{&quot;name&quot;:&quot;A&quot;,&quot;value&quot;:40},{&quot;name&quot;:&quot;B&quot;,&quot;value&quot;:60}]}\"></div>",
  "Use only numbers in data/value (no units, no strings). Escape every double quote inside the attribute as &quot;.",
].join("\n");


export function sanitizeArtifactPart(value: string): string {
  const fragment = value
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .trim();
  return sanitizeHtml(fragment, {
    allowedTags: [
      "a", "abbr", "article", "aside", "b", "blockquote", "br", "button",
      "caption", "cite", "code", "col", "colgroup", "dd", "details", "div",
      "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3",
      "h4", "h5", "h6", "header", "hr", "i", "img", "kbd", "li", "main",
      "mark", "nav", "ol", "p", "pre", "q", "s", "section", "small", "span",
      "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
      "thead", "time", "tr", "u", "ul", "var",
    ],
    allowedAttributes: {
      "*": ["class", "id", "style", "title", "role", "aria-*", "data-*"],
      a: ["href", "target", "rel"],
      button: ["type"],
      col: ["span"],
      img: ["src", "alt", "width", "height", "loading"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      time: ["datetime"],
    },
    allowedSchemes: ["http", "https", "data"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => {
        const href = attributes.href ?? "";
        if (href.startsWith("#")) return { tagName: "a", attribs: attributes };
        return {
          tagName: "a",
          attribs: { ...attributes, target: "_blank", rel: "noopener noreferrer" },
        };
      },
    },
  }).trim();
}

export function compileArtifactHtml(input: {
  title: string;
  mode: "document" | "presentation" | "dashboard";
  theme: { preset: string; accent: string };
  parts: ArtifactPartPlan[];
  stored: Array<{ id: string; content: string }>;
}): { html: string; partsOk: number; partsFailed: number } {
  const accent = /^#[0-9a-f]{3,8}$/i.test(input.theme.accent) ? input.theme.accent : "#2563eb";
  const byId = new Map(input.stored.map((part) => [part.id, part]));
  let partsOk = 0;
  let partsFailed = 0;
  const sections = input.parts.map((planned) => {
    const stored = byId.get(planned.id);
    if (!stored) {
      partsFailed += 1;
      return renderErrorSection(planned, "part missing from generation output");
    }
    let parsed: { html?: string; error?: string };
    try {
      parsed = JSON.parse(stored.content) as typeof parsed;
    } catch {
      partsFailed += 1;
      return renderErrorSection(planned, "part content is not valid JSON");
    }
    if (parsed.error || !parsed.html) {
      partsFailed += 1;
      return renderErrorSection(planned, parsed.error ?? "part produced no HTML");
    }
    partsOk += 1;
    return `<section id="${escapeAttribute(planned.id)}" class="artifact-block artifact-block--${escapeAttribute(planned.type)}" data-block-id="${escapeAttribute(planned.id)}"><div class="artifact-block__content">${compileCharts(parsed.html, accent)}</div></section>`;
  });
  const usesEcharts = input.mode === "dashboard" || sections.some((section) => section.includes("data-chart-option"));
  const html = [
    "<!doctype html>", '<html lang="zh-CN">', "<head>", '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(input.title)}</title>`, buildArtifactRuntimeHead({ usesEcharts }),
    `  <style>${artifactModeStyles(input.mode, input.theme.accent)}</style>`, "</head>", "<body>",
    ...sections, buildChartHydrationScript(), buildArtifactNavScript(), "</body>", "</html>",
  ].join("\n");
  return { html, partsOk, partsFailed };
}

function renderErrorSection(part: ArtifactPartPlan, reason: string): string {
  return `<section class="artifact-block artifact-block--${escapeAttribute(part.type)} artifact-block--error" data-block-id="${escapeAttribute(part.id)}"><div class="artifact-block__content"><h2>${escapeHtml(part.title)}</h2><p class="artifact-block__error">本节生成失败：${escapeHtml(reason)}</p></div></section>`;
}

// Charts are compile-owned. The block author only declares intent via
// `data-chart` (type + categories + numeric series); the compiler expands that
// into a canonical, theme-colored ECharts option. The model never hand-writes
// ECharts/Chart.js structure, so it cannot emit a broken option. A legacy
// `data-chart-option` path is kept only as a strict safety net for older
// content and is validated/coerced before it can reach the runtime.
function compileCharts(html: string, accent: string): string {
  const withSpecs = html.replace(/data-chart=(["'])([\s\S]*?)\1/gi, (_match, _quote, raw) => {
    const decoded = decodeAttribute(String(raw));
    let spec: unknown;
    try {
      spec = JSON.parse(decoded);
    } catch {
      return 'data-chart-invalid="true"';
    }
    const option = expandChartSpec(spec, accent);
    if (!option) return 'data-chart-invalid="true"';
    return `data-chart-option="${escapeAttribute(JSON.stringify(option))}"`;
  });
  return validateChartOptions(withSpecs, accent);
}

const CHART_TYPES = new Set(["bar", "line", "area", "pie"]);

type ChartSpec = {
  type: string;
  title?: unknown;
  categories?: unknown;
  series?: unknown;
  stack?: unknown;
  horizontal?: unknown;
};

// Deterministic expansion of the minimal declarative spec into a full ECharts
// option. This is the single source of chart styling: palette, axes, legend,
// tooltip, and label rules all live here, not in model output.
function expandChartSpec(spec: unknown, accent: string): Record<string, unknown> | null {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const input = spec as ChartSpec;
  const type = typeof input.type === "string" ? input.type.toLowerCase() : "";
  if (!CHART_TYPES.has(type)) return null;
  const palette = chartPalette(accent);
  const title =
    typeof input.title === "string" && input.title.trim()
      ? { title: { text: input.title.trim(), left: "center", textStyle: { fontSize: 16, fontWeight: 600 } } }
      : {};

  if (type === "pie") {
    const slices = normalizePieData(input.series, input.categories);
    if (!slices.length) return null;
    return {
      color: palette,
      ...title,
      tooltip: { trigger: "item" },
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          label: { show: true, formatter: "{b}: {d}%" },
          data: slices,
        },
      ],
    };
  }

  const categories = Array.isArray(input.categories) ? input.categories.map((c) => String(c)) : [];
  const series = normalizeCartesianSeries(input.series, type);
  if (!series.length) return null;
  const horizontal = input.horizontal === true;
  const stack = input.stack === true ? "total" : undefined;
  const categoryAxis = { type: "category" as const, data: categories };
  const valueAxis = { type: "value" as const };
  return {
    color: palette,
    ...title,
    tooltip: { trigger: "axis" },
    legend: series.length > 1 ? { bottom: 0 } : undefined,
    grid: { left: "3%", right: "4%", bottom: series.length > 1 ? "12%" : "6%", top: title.title ? 48 : 24, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: series.map((s) => ({
      name: s.name,
      type: type === "area" ? "line" : type,
      stack,
      smooth: type === "line" || type === "area",
      areaStyle: type === "area" ? {} : undefined,
      data: s.data,
    })),
  };
}

function chartPalette(accent: string): string[] {
  return [accent, "#10b981", "#f59e0b", "#6366f1", "#ec4899", "#06b6d4", "#84cc16", "#f43f5e"];
}

function normalizeCartesianSeries(
  raw: unknown,
  _type: string,
): Array<{ name?: string; data: number[] }> {
  if (!Array.isArray(raw)) return [];
  // Accept either [{name,data:[...]}] or a bare number array [1,2,3].
  if (raw.every((v) => typeof v === "number")) {
    return [{ data: raw as number[] }];
  }
  const out: Array<{ name?: string; data: number[] }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!Array.isArray(row.data)) continue;
    const data = row.data.map((n) => (typeof n === "number" ? n : Number(n))).map((n) => (Number.isFinite(n) ? n : 0));
    out.push({ name: typeof row.name === "string" ? row.name : undefined, data });
  }
  return out;
}

function normalizePieData(raw: unknown, categories: unknown): Array<{ name: string; value: number }> {
  // Pie accepts [{name,value}], a bare number array aligned with categories,
  // or a single-series [{data:[...]}].
  if (Array.isArray(raw) && raw.every((v) => typeof v === "number") && Array.isArray(categories)) {
    return (raw as number[]).map((value, i) => ({ name: String(categories[i] ?? i), value }));
  }
  if (Array.isArray(raw)) {
    const first = raw[0] as Record<string, unknown> | undefined;
    if (first && Array.isArray(first.data) && Array.isArray(categories)) {
      return (first.data as unknown[]).map((value, i) => ({
        name: String(categories[i] ?? i),
        value: Number(value) || 0,
      }));
    }
    const out: Array<{ name: string; value: number }> = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (row.name == null || row.value == null) continue;
      out.push({ name: String(row.name), value: Number(row.value) || 0 });
    }
    return out;
  }
  return [];
}

function validateChartOptions(html: string, accent: string): string {
  return html.replace(/data-chart-option=(["'])([\s\S]*?)\1/gi, (match, _quote, raw) => {
    const decoded = decodeAttribute(String(raw));
    const normalized = normalizeChartOptionJson(decoded);
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      return 'data-chart-invalid="true"';
    }
    // The runtime calls echarts.setOption(option), which throws on anything that
    // is not a valid ECharts option object (e.g. a Chart.js {type,data} shape).
    // Coerce common Chart.js output, then require a usable series so a malformed
    // chart degrades to visible text instead of crashing hydration at view time.
    const option = coerceEChartsOption(parsed);
    if (!option) return 'data-chart-invalid="true"';
    if (!("color" in option)) option.color = chartPalette(accent);
    return `data-chart-option="${escapeAttribute(JSON.stringify(option))}"`;
  });
}

function coerceEChartsOption(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const option = parsed as Record<string, unknown>;
  if (isUsableSeries(option.series)) return option;
  const converted = convertChartJsOption(option);
  if (converted && isUsableSeries(converted.series)) return converted;
  return null;
}

function isUsableSeries(series: unknown): boolean {
  if (Array.isArray(series)) return series.length > 0;
  return Boolean(series && typeof series === "object");
}

// Best-effort conversion of the Chart.js shape {type,data:{labels,datasets}}
// that LLMs frequently emit by habit into a minimal ECharts option.
function convertChartJsOption(option: Record<string, unknown>): Record<string, unknown> | null {
  const type = typeof option.type === "string" ? option.type : null;
  const data = option.data && typeof option.data === "object" ? (option.data as Record<string, unknown>) : null;
  if (!type || !data) return null;
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const datasets = Array.isArray(data.datasets) ? (data.datasets as Array<Record<string, unknown>>) : [];
  if (!datasets.length) return null;
  if (type === "pie" || type === "doughnut") {
    const values = Array.isArray(datasets[0]?.data) ? (datasets[0].data as unknown[]) : [];
    return {
      series: [
        {
          type: "pie",
          data: values.map((value, index) => ({ name: String(labels[index] ?? index), value })),
        },
      ],
    };
  }
  const seriesType = type === "line" ? "line" : "bar";
  return {
    xAxis: { type: "category", data: labels },
    yAxis: { type: "value" },
    series: datasets.map((dataset) => ({
      type: seriesType,
      name: typeof dataset.label === "string" ? dataset.label : undefined,
      data: Array.isArray(dataset.data) ? dataset.data : [],
    })),
  };
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeChartOptionJson(value: string): string {
  return value.replace(
    /"formatter"\s*:\s*function\s*\([^)]*\)\s*\{[^{}]*\}/g,
    '"formatter":"{c}"',
  );
}

function artifactModeStyles(mode: "document" | "presentation" | "dashboard", rawAccent: string): string {
  const accent = /^#[0-9a-f]{3,8}$/i.test(rawAccent) ? rawAccent : "#2563eb";
  const base = [
    // Design tokens: one source of truth for color, spacing, type, radius so
    // every independently generated block resolves to the same visual system.
    `:root{color-scheme:light;--accent:${accent};--accent-weak:color-mix(in srgb,var(--accent) 16%,transparent);--bg:#eef1f5;--surface:#fff;--surface-2:#f1f5f9;--text:#0f172a;--text-muted:#64748b;--border:#e2e8f0;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;--space-7:48px;--radius:14px;--radius-sm:8px;--shadow:0 8px 30px rgba(15,23,42,.08);--maxw:1120px;--font-sans:Inter,"Segoe UI",ui-sans-serif,system-ui,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-family:var(--font-sans);}`,
    `*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--text);}`,
    // Typography + automatic vertical rhythm: even classless semantic markup
    // gets consistent spacing via the owl selector, so blocks never drift.
    `.artifact-block__content{font-size:16px;line-height:1.7;color:var(--text);overflow-wrap:anywhere;}`,
    `.artifact-block__content>*+*{margin-top:var(--space-4);}`,
    `h1,h2,h3,h4,h5,h6{margin:0;font-weight:700;line-height:1.2;letter-spacing:-.01em;text-wrap:pretty;}`,
    `h1{font-size:2.2rem;font-weight:800;letter-spacing:-.02em;}h2{font-size:1.6rem;}h3{font-size:1.25rem;}h4{font-size:1.05rem;}`,
    `p{margin:0;}a{color:var(--accent);text-underline-offset:2px;}strong{font-weight:700;}small,.muted{color:var(--text-muted);}small{font-size:.85em;}`,
    `ul,ol{margin:0;padding-left:1.4em;}li+li{margin-top:var(--space-2);}`,
    `blockquote{margin:0;padding:var(--space-3) var(--space-5);border-left:3px solid var(--accent);background:var(--surface-2);border-radius:0 var(--radius-sm) var(--radius-sm) 0;}`,
    `code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);padding:.1em .35em;border-radius:6px;font-size:.9em;}`,
    `hr,.divider{border:none;border-top:1px solid var(--border);margin:var(--space-5) 0;}`,
    `table{width:100%;border-collapse:collapse;font-size:.95rem;}thead th{background:var(--surface-2);text-align:left;}th,td{padding:10px 12px;border:1px solid var(--border);}tbody tr:nth-child(even){background:var(--surface-2);}`,
    `img,svg,canvas{max-width:100%;height:auto;border-radius:var(--radius-sm);}figure{margin:0;}figcaption{font-size:.85rem;color:var(--text-muted);margin-top:var(--space-2);text-align:center;}`,
    // Utility + component kit: the only layout vocabulary blocks may compose.
    `.eyebrow{font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);}`,
    `.lead{font-size:1.15rem;line-height:1.6;color:var(--text-muted);}.center{text-align:center;}`,
    `.stack{display:flex;flex-direction:column;gap:var(--space-4);}.stack-sm{display:flex;flex-direction:column;gap:var(--space-2);}.stack-lg{display:flex;flex-direction:column;gap:var(--space-6);}`,
    `.row{display:flex;gap:var(--space-4);flex-wrap:wrap;}.cluster{display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center;}.split{display:flex;justify-content:space-between;align-items:center;gap:var(--space-4);flex-wrap:wrap;}`,
    `.grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--space-4);}.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-4);}.grid-4{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-4);}`,
    `.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:var(--space-5);}.card>*+*{margin-top:var(--space-3);}.card--accent{border-top:3px solid var(--accent);}`,
    `.kpi{display:flex;flex-direction:column;gap:var(--space-1);}.kpi__value{font-size:2.2rem;font-weight:800;line-height:1;color:var(--accent);letter-spacing:-.02em;}.kpi__label{font-size:.9rem;color:var(--text-muted);}`,
    `.badge{display:inline-flex;align-items:center;gap:.35em;padding:.25em .7em;border-radius:999px;background:var(--accent-weak);color:var(--accent);font-size:.8rem;font-weight:600;}`,
    `.callout{padding:var(--space-4);border-radius:var(--radius-sm);background:var(--surface-2);border:1px solid var(--border);border-left:3px solid var(--accent);}.callout>*+*{margin-top:var(--space-2);}.callout--info{border-left-color:#0ea5e9;}.callout--success{border-left-color:#16a34a;}.callout--warn{border-left-color:#d97706;}`,
    `.timeline{display:flex;flex-direction:column;gap:var(--space-4);padding-left:var(--space-5);border-left:2px solid var(--border);}.timeline__item{position:relative;}.timeline__item::before{content:"";position:absolute;left:calc(-1*var(--space-5) - 1px);top:.45em;width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-weak);}.timeline__time{font-weight:700;color:var(--accent);}`,
    `[data-chart-option]{min-height:360px;width:100%;}[data-chart-invalid]{min-height:auto;}`,
    `.artifact-block--error{border:1px solid #fecaca;}.artifact-block__error{color:#b91c1c;font-weight:600;}`,
    `@media print{body{background:#fff;}.artifact-block{width:100%;margin:0;border-radius:0;box-shadow:none;min-height:auto;}}`,
  ];
  if (mode === "presentation") {
    // Slides grow with content (min-height, not fixed/aspect-ratio) so tall
    // blocks never clip; short blocks still center like a slide.
    base.push(`.artifact-block{width:min(1280px,calc(100% - 32px));min-height:min(88vh,720px);margin:24px auto;padding:var(--space-7);background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);break-after:page;display:flex;flex-direction:column;gap:var(--space-5);justify-content:center;}`);
  } else if (mode === "dashboard") {
    base.push(
      `:root{--bg:#0b1120;--surface:#111827;--surface-2:#0f1a2e;--text:#e5e7eb;--text-muted:#94a3b8;--border:#1f2937;--shadow:0 8px 30px rgba(0,0,0,.4);}`,
      `.artifact-block{width:min(1280px,calc(100% - 32px));margin:16px auto;padding:var(--space-5);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);}`,
    );
  } else {
    base.push(
      `.artifact-block{width:min(var(--maxw),calc(100% - 32px));min-height:640px;margin:24px auto;padding:var(--space-7);background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);break-after:page;}`,
      // Cards on a white document page use the tint surface so they read as panels.
      `.artifact-block .card{background:var(--surface-2);}`,
    );
  }
  return base.join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string { return escapeHtml(value).replace(/'/g, "&#39;"); }

export type ArtifactValidation = {
  ok: boolean;
  structural_errors: string[];
  broken_internal_links: string[];
};

export type ArtifactInspection = {
  pages: number;
  charts: number;
  invalid_charts: number;
  internal_links: number;
  broken_internal_links: string[];
  failed_blocks: Array<{ id: string; reason: string }>;
  total_chars: number;
};

// Correctness gate over a compiled artifact: things that make the document
// objectively wrong (unparseable shell, unsafe inline JS, dangling anchors).
// Layout/visual issues are out of scope — those are for the human preview.
export function validateArtifactHtml(html: string): ArtifactValidation {
  const brokenInternalLinks = findBrokenInternalLinks(html);
  const structuralErrors = [
    !/^\s*<!doctype html>/i.test(html) ? "missing doctype" : null,
    !/<\/html>\s*$/i.test(html) ? "missing closing html tag" : null,
    /\son[a-z]+\s*=/i.test(html) ? "inline event handler detected" : null,
    /javascript\s*:/i.test(html) ? "javascript URL detected" : null,
    (html.match(/<html\b/gi) ?? []).length > 1 ? "nested html document" : null,
    (html.match(/<body\b/gi) ?? []).length > 1 ? "nested body element" : null,
  ].filter((value): value is string => value != null);
  return {
    ok: structuralErrors.length === 0 && brokenInternalLinks.length === 0,
    structural_errors: structuralErrors,
    broken_internal_links: brokenInternalLinks,
  };
}

// Layout/content signal over a compiled artifact. Surfaces the compiler's own
// degradation markers (error sections, invalid charts) so a reviewer or the
// model can see which pages need a follow-up edit instead of guessing.
export function inspectArtifactHtml(html: string): ArtifactInspection {
  const pages = (html.match(/\bclass="[^"]*artifact-block\b/g) ?? []).length;
  const charts = (html.match(/\bdata-chart-option=/g) ?? []).length;
  const invalidCharts = (html.match(/\bdata-chart-invalid=/g) ?? []).length;
  const internalLinks = [...html.matchAll(/href=["']#([^"']+)["']/g)].length;
  return {
    pages,
    charts,
    invalid_charts: invalidCharts,
    internal_links: internalLinks,
    broken_internal_links: findBrokenInternalLinks(html),
    failed_blocks: findFailedBlocks(html),
    total_chars: html.length,
  };
}

function findBrokenInternalLinks(html: string): string[] {
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const targets = [...html.matchAll(/href=["']#([^"']+)["']/g)].map((match) => match[1]!);
  return [...new Set(targets.filter((target) => target && !ids.has(target)))];
}

function findFailedBlocks(html: string): Array<{ id: string; reason: string }> {
  const blocks: Array<{ id: string; reason: string }> = [];
  const re = /<section[^>]*\bclass="[^"]*artifact-block--error[^"]*"[^>]*\bdata-block-id="([^"]*)"[\s\S]*?<p class="artifact-block__error">([\s\S]*?)<\/p>/gi;
  for (const match of html.matchAll(re)) {
    blocks.push({
      id: match[1] ?? "",
      reason: match[2]?.replace(/<[^>]+>/g, "").trim().slice(0, 200) ?? "",
    });
  }
  return blocks;
}
