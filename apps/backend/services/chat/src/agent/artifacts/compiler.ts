import { buildArtifactNavScript, buildArtifactRuntimeHead, buildChartHydrationScript } from "./template.js";
import sanitizeHtml from "sanitize-html";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export type ArtifactPartPlan = { id: string; type: string; title: string };

// Visual design belongs to the block generator. The compiler only supplies a
// safe document shell and runtime capabilities; it must not impose a theme,
// layout system, page size, or component vocabulary on generated artifacts.
export const ARTIFACT_VISUAL_CAPABILITIES = [
  "Own the complete visual direction: color scheme, typography, spacing, density, composition, and responsive behavior.",
  "Use semantic HTML plus arbitrary classes and CSS. A scoped <style> element is allowed inside the fragment.",
  "Scope every CSS selector under the compiler-provided block id so independently generated blocks cannot restyle one another.",
  "Do not target html, body, or :root. Do not load external CSS, fonts, images, or other resources from CSS.",
].join("\n");

// The compact chart spec is convenient, while data-chart-option gives the
// model full control over ECharts styling without allowing executable code.
export const ARTIFACT_CHART_SPEC = [
  "Charts are empty div elements hydrated by the compiler. Never emit <script>, <canvas>, or JavaScript functions.",
  "Chart spec fields: type (one of \"bar\" | \"line\" | \"area\" | \"pie\"), title (optional string), categories (string[] for bar/line/area; the x-axis labels), series (see below), optional stack:true, optional horizontal:true.",
  "series for bar/line/area: an array of {\"name\":string,\"data\":number[]} aligned with categories; for a single series you may pass a bare number[]: \"data\".",
  "series for pie: an array of {\"name\":string,\"value\":number}.",
  "Bar example: <div data-chart=\"{&quot;type&quot;:&quot;bar&quot;,&quot;title&quot;:&quot;销量&quot;,&quot;categories&quot;:[&quot;Q1&quot;,&quot;Q2&quot;],&quot;series&quot;:[{&quot;name&quot;:&quot;华东&quot;,&quot;data&quot;:[120,200]}]}\"></div>",
  "Pie example: <div data-chart=\"{&quot;type&quot;:&quot;pie&quot;,&quot;series&quot;:[{&quot;name&quot;:&quot;A&quot;,&quot;value&quot;:40},{&quot;name&quot;:&quot;B&quot;,&quot;value&quot;:60}]}\"></div>",
  "For full visual control, use data-chart-option with an escaped JSON ECharts option object containing a non-empty series. Set its color, backgroundColor, textStyle, title, legend, axes, grid, labels, and tooltip to match your design.",
  "Use only numbers in data/value (no units, no strings). Escape every double quote inside the attribute as &quot;.",
].join("\n");

function stripUnsafeCss(value: string): string {
  return value
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(?:behavior|-moz-binding)\s*:[^;}]*/gi, "")
    .replace(/javascript\s*:/gi, "");
}

function sanitizeArtifactCss(value: string, scopeId: string): string {
  const cleaned = stripUnsafeCss(value);
  try {
    const root = postcss.parse(cleaned);
    const keyframes = new Map<string, string>();
    root.walkAtRules((rule) => {
      if (["import", "namespace", "page", "font-face"].includes(rule.name.toLowerCase())) {
        rule.remove();
      } else if (/keyframes$/i.test(rule.name)) {
        const name = rule.params.trim();
        if (!/^[A-Za-z_][\w-]*$/.test(name)) {
          rule.remove();
        } else {
          const scopedName = `${scopeId}-${name}`;
          keyframes.set(name, scopedName);
          rule.params = scopedName;
        }
      }
    });
    root.walkDecls((declaration) => {
      if (!["animation", "animation-name"].includes(declaration.prop.toLowerCase())) return;
      for (const [name, scopedName] of keyframes) {
        declaration.value = declaration.value.replace(
          new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
          scopedName,
        );
      }
    });
    root.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
      try {
        const parsed = selectorParser().astSync(rule.selector);
        let unsafe = false;
        parsed.walkTags((tag) => {
          if (["html", "body"].includes(tag.value.toLowerCase())) unsafe = true;
        });
        parsed.walkPseudos((pseudo) => {
          if (pseudo.value.toLowerCase() === ":root") unsafe = true;
        });
        if (unsafe) {
          rule.remove();
          return;
        }
        rule.selector = parsed.nodes
          .map((selector) => {
            const first = selector.nodes[0];
            return first?.type === "id" && first.value === scopeId
              ? selector.toString()
              : `#${scopeId} ${selector.toString()}`;
          })
          .join(",");
      } catch {
        rule.remove();
      }
    });
    return root.toString();
  } catch {
    return "";
  }
}

export function sanitizeArtifactPart(value: string, scopeId: string): string {
  const fragment = value
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .trim();
  const sanitizedCss = fragment
    .replace(
      /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
      (_match, css) => `<style>${sanitizeArtifactCss(String(css), scopeId)}</style>`,
    )
    .replace(
      /\sstyle=(["'])([\s\S]*?)\1/gi,
      (_match, quote, css) => ` style=${quote}${stripUnsafeCss(String(css))}${quote}`,
    );
  return sanitizeHtml(sanitizedCss, {
    allowedTags: [
      "a", "abbr", "article", "aside", "b", "blockquote", "br", "button",
      "caption", "cite", "code", "col", "colgroup", "dd", "details", "div",
      "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3",
      "h4", "h5", "h6", "header", "hr", "i", "img", "kbd", "li", "main",
      "mark", "nav", "ol", "p", "pre", "q", "s", "section", "small", "span", "style",
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
    allowVulnerableTags: true,
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
  theme: { visualDirection: string; accent: string };
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
  const usesEcharts = sections.some((section) => section.includes("data-chart-option"));
  const html = [
    "<!doctype html>", '<html lang="zh-CN">', "<head>", '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(input.title)}</title>`, buildArtifactRuntimeHead({ usesEcharts }),
    `  <style>${artifactRuntimeStyles()}</style>`, "</head>", "<body>",
    ...sections, buildChartHydrationScript(), buildArtifactNavScript(), "</body>", "</html>",
  ].join("\n");
  return { html, partsOk, partsFailed };
}

function renderErrorSection(part: ArtifactPartPlan, reason: string): string {
  return `<section class="artifact-block artifact-block--${escapeAttribute(part.type)} artifact-block--error" data-block-id="${escapeAttribute(part.id)}"><div class="artifact-block__content"><h2>${escapeHtml(part.title)}</h2><p class="artifact-block__error">本节生成失败：${escapeHtml(reason)}</p></div></section>`;
}

// A compact data-chart spec gets safe defaults, while data-chart-option lets
// the model own the complete visual treatment. Both paths remain JSON-only and
// require a usable series before reaching the browser runtime.
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
    if (decoded.length > 100_000) return 'data-chart-invalid="true"';
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
    if (!option || !isBoundedChartOption(option)) return 'data-chart-invalid="true"';
    if (!("color" in option)) option.color = chartPalette(accent);
    return `data-chart-option="${escapeAttribute(JSON.stringify(option))}"`;
  });
}

function isBoundedChartOption(option: Record<string, unknown>): boolean {
  const state = { nodes: 0, points: 0 };
  const visit = (value: unknown, depth: number, key = ""): boolean => {
    state.nodes += 1;
    if (state.nodes > 12_000 || depth > 16) return false;
    if (typeof value === "string") return value.length <= 10_000;
    if (value == null || typeof value === "number" || typeof value === "boolean") return true;
    if (Array.isArray(value)) {
      if (value.length > 5_000) return false;
      if (key === "data" || key === "source") {
        state.points += value.length;
        if (state.points > 10_000) return false;
      }
      return value.every((item) => visit(item, depth + 1));
    }
    if (typeof value !== "object") return false;
    return Object.entries(value as Record<string, unknown>).every(
      ([childKey, child]) => visit(child, depth + 1, childKey),
    );
  };
  const series = Array.isArray(option.series) ? option.series : [option.series];
  return series.length <= 20 && visit(option, 0);
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

function artifactRuntimeStyles(): string {
  return [
    "*{box-sizing:border-box;}",
    "html,body{margin:0;min-height:100%;}",
    ".artifact-block{position:relative;}",
    ".artifact-block__content{min-width:0;overflow-wrap:anywhere;}",
    "img,svg,canvas{max-width:100%;height:auto;}",
    "[data-chart-option]{min-height:360px;width:100%;}",
    "[data-chart-invalid]{min-height:auto;}",
    ".artifact-block--error{padding:24px;border:1px solid #fecaca;background:#fef2f2;}",
    ".artifact-block__error{color:#b91c1c;font-weight:600;}",
    "@media print{.artifact-block{break-after:page;}}",
  ].join("\n");
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
