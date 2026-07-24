import { buildArtifactNavScript, buildArtifactRuntimeHead, buildChartHydrationScript, buildEChartsScriptExecutionScript } from "./template.js";
import sanitizeHtml from "sanitize-html";
import { DomUtils, parseDocument } from "htmlparser2";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { expandDiagramChartSpec, type DiagramChartSpec } from "./diagram-charts.js";
import { bindStaticDataSelectors } from "./script-bindings.js";
export type ArtifactPartPlan = { id: string; type: string; title: string };
export const ARTIFACT_VISUAL_CAPABILITIES = [
  "The platform owns the responsive shell, accessible color tokens, typography, spacing scale, and reusable Grid/Flex primitives.",
  "Compose layouts with artifact-stack, artifact-cluster, artifact-grid, artifact-split, artifact-card, artifact-metric-grid, artifact-frame, artifact-table-scroll, and artifact-prose.",
  "Use semantic HTML. A scoped <style> element is allowed only for topic-specific composition that the platform primitives cannot express.",
  "Use platform CSS variables such as --artifact-accent, --artifact-text, --artifact-muted, --artifact-surface, --artifact-gap, and --artifact-radius instead of inventing a page-level design system.",
  "Scope every custom selector under the compiler-provided block id. Never target html, body, :root, or another block.",
  "Prefer Grid/Flex with minmax(0,1fr), min-width:0, max-width:100%, auto-fit, clamp(), and wrapping. Avoid fixed widths, rigid min-width, fixed positioning, and nowrap content.",
  "Wrap every table in artifact-table-scroll. Images, charts, tables, and code must remain usable on narrow viewports.",
  "Do not load external CSS, fonts, images, or other resources from CSS.",
].join("\n");
export const ARTIFACT_CHART_SPEC = [
  "Prefer compiler-hydrated chart divs for standard charts. Use custom JavaScript only when the requested interaction cannot be expressed by the chart spec.",
  "Chart spec type is one of \"bar\" | \"line\" | \"area\" | \"pie\" | \"radar\" | \"tree\" | \"graph\" | \"gantt\". title is optional.",
  "series for bar/line/area: an array of {\"name\":string,\"data\":number[]} aligned with categories; for a single series you may pass a bare number[] as series.",
  "series for pie: an array of {\"name\":string,\"value\":number}.",
  "series for radar: an array of {\"name\":string,\"data\":number[]} aligned with categories (one value per indicator).",
  "tree uses data:{name:string,children?:node[]} (or an array of roots), optional layout:\"orthogonal\"|\"radial\", optional orient:\"LR\"|\"RL\"|\"TB\"|\"BT\". Use tree for organization charts and mind maps.",
  "graph uses nodes:[{id:string,name:string,category?:string,value?:string|number}] and links:[{source:string,target:string,name?:string}], optional layout:\"force\"|\"circular\". Use graph for relation-first networks and dependency-topology exploration. Do not default a project or system architecture diagram to graph: conventional layered, container, deployment, and request-flow architecture should use stable semantic HTML/CSS layout with inline SVG or Canvas where needed. Do not use layout:none unless every graph node has explicit x/y coordinates.",
  "gantt uses tasks:[{name:string,start:number,end:number,stage?:string}] where end is greater than start. Use numeric project units such as day or week; the compiler builds the timeline bars.",
  "Bar example: <div data-chart=\"{&quot;type&quot;:&quot;bar&quot;,&quot;title&quot;:&quot;销量&quot;,&quot;categories&quot;:[&quot;Q1&quot;,&quot;Q2&quot;],&quot;series&quot;:[{&quot;name&quot;:&quot;华东&quot;,&quot;data&quot;:[120,200]}]}\"></div>",
  "Pie example: <div data-chart=\"{&quot;type&quot;:&quot;pie&quot;,&quot;series&quot;:[{&quot;name&quot;:&quot;A&quot;,&quot;value&quot;:40},{&quot;name&quot;:&quot;B&quot;,&quot;value&quot;:60}]}\"></div>",
  "Radar example: <div data-chart=\"{&quot;type&quot;:&quot;radar&quot;,&quot;max&quot;:100,&quot;categories&quot;:[&quot;A&quot;,&quot;B&quot;,&quot;C&quot;],&quot;series&quot;:[{&quot;name&quot;:&quot;2024&quot;,&quot;data&quot;:[40,55,70]},{&quot;name&quot;:&quot;2026&quot;,&quot;data&quot;:[60,75,88]}]}\"></div>",
  "Only when the chart spec cannot express the design, use data-chart-option with escaped JSON ECharts option. Never hand-write data-chart-option or ECharts initialization JavaScript for a supported chart type.",
  "Never hide a data-chart or data-chart-option element. Remove a redundant chart instead of using display:none or aria-hidden.",
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
function stripRootCanvasCss(value: string): string {
  try {
    const root = postcss.parse(`x{${stripUnsafeCss(value)}}`);
    const rule = root.first;
    if (!rule || rule.type !== "rule") return "";
    rule.walkDecls((declaration) => {
      const property = declaration.prop.toLowerCase();
      if (property === "color" || property === "color-scheme" || property.startsWith("background")) {
        declaration.remove();
      }
    });
    return (rule.nodes ?? []).map((node) => node.toString()).join(";");
  } catch {
    return "";
  }
}
type HtmlNode = {
  type?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  data?: string;
};
const BLOCK_ID_PATTERN = /^page-[1-9]\d*$/;
const IDREF_ATTRIBUTES = ["aria-activedescendant", "aria-controls", "aria-describedby", "aria-details", "aria-errormessage", "aria-flowto", "aria-labelledby", "aria-owns"];

function htmlNodes(root: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = [];
  const visit = (node: HtmlNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}

function collectLocalIds(value: string, scopeId: string): Map<string, string> {
  const root = parseDocument(value, { lowerCaseAttributeNames: false }) as unknown as HtmlNode;
  const ids = new Map<string, string>();
  for (const node of htmlNodes(root)) {
    const id = node.attribs?.id;
    if (!id || id === scopeId || BLOCK_ID_PATTERN.test(id)) continue;
    const prefix = `${scopeId}--`;
    if (id.startsWith(prefix)) {
      ids.set(id.slice(prefix.length), id);
    } else {
      ids.set(id, `${prefix}${id}`);
    }
  }
  return ids;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteJavaScriptIdReferences(value: string, localIds: Map<string, string>): string {
  let result = "";
  let cursor = 0;
  while (cursor < value.length) {
    const quote = value[cursor];
    if (quote !== '"' && quote !== "'") {
      result += quote;
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (end < value.length) {
      if (value[end] === "\\") {
        end += 2;
        continue;
      }
      if (value[end] === quote) break;
      end += 1;
    }
    if (end >= value.length) {
      result += value.slice(cursor);
      break;
    }
    const before = value.slice(0, cursor);
    let content = value.slice(cursor + 1, end);
    for (const [localId, namespacedId] of localIds) {
      content = content.replace(
        new RegExp(`#${escapeRegExp(localId)}(?![\\w-])`, "g"),
        `#${namespacedId}`,
      );
      if (/getElementById\s*\(\s*$/.test(before) && content === localId) {
        content = namespacedId;
      }
    }
    result += `${quote}${content}${quote}`;
    cursor = end + 1;
  }
  return result;
}

function sanitizeArtifactCss(value: string, scopeId: string, localIds: Map<string, string>): string {
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
        parsed.walkIds((id) => {
          id.value = localIds.get(id.value) ?? id.value;
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
function namespaceArtifactIds(value: string, scopeId: string, localIds: Map<string, string>): string {
  const root = parseDocument(value, { lowerCaseAttributeNames: false }) as unknown as HtmlNode;
  for (const node of htmlNodes(root)) {
    if (node.type === "script") {
      const attributes = node.attribs ?? (node.attribs = {});
      const scriptType = (attributes.type ?? "").trim();
      const isJavaScript = /^(?:|module|text\/javascript|application\/javascript)$/i.test(scriptType);
      for (const child of node.children ?? []) {
        if (typeof child.data === "string") {
          child.data = rewriteJavaScriptIdReferences(child.data, localIds);
          if (isJavaScript && /\becharts\b/i.test(child.data)) {
            if (scriptType) attributes["data-artifact-original-type"] = scriptType;
            attributes.type = "application/x-artifact-echarts";
          }
        }
      }
    }
    const attributes = node.attribs;
    if (!attributes) continue;
    const id = attributes.id;
    if (id === scopeId || (id && BLOCK_ID_PATTERN.test(id))) {
      delete attributes.id;
    } else if (id) {
      attributes.id = localIds.get(id) ?? id;
    }
    const href = attributes.href;
    if (href?.startsWith("#")) {
      const target = href.slice(1);
      const namespaced = localIds.get(target);
      if (namespaced) attributes.href = `#${namespaced}`;
    }
    for (const attribute of IDREF_ATTRIBUTES) {
      const value = attributes[attribute];
      if (!value) continue;
      attributes[attribute] = value
        .split(/\s+/)
        .map((token) => localIds.get(token) ?? token)
        .join(" ");
    }
    for (const [name, value] of Object.entries(attributes)) {
      if (/^on/i.test(name)) {
        attributes[name] = rewriteJavaScriptIdReferences(value, localIds);
      }
    }
  }
  for (const child of root.children ?? []) {
    if (child.type !== "tag") continue;
    const attributes = child.attribs ?? (child.attribs = {});
    const classes = new Set((attributes.class ?? "").split(/\s+/).filter(Boolean));
    classes.add("artifact-block-root");
    attributes.class = [...classes].join(" ");
    if (attributes.style) {
      const style = stripRootCanvasCss(attributes.style);
      if (style) attributes.style = style;
      else delete attributes.style;
    }
  }
  return DomUtils.getInnerHTML(root as never).trim();
}

export function sanitizeArtifactPart(value: string, scopeId: string): string {
  const fragment = value
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .trim();
  const localIds = collectLocalIds(fragment, scopeId);
  const sanitizedCss = fragment
    .replace(
      /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
      (_match, css) => `<style>${sanitizeArtifactCss(String(css), scopeId, localIds)}</style>`,
    )
    .replace(
      /\sstyle=(["'])([\s\S]*?)\1/gi,
      (_match, quote, css) => ` style=${quote}${stripUnsafeCss(String(css))}${quote}`,
    );
  const sanitized = sanitizeHtml(sanitizedCss, {
    allowedTags: [
      "a", "abbr", "article", "aside", "b", "blockquote", "br", "button",
      "caption", "cite", "code", "col", "colgroup", "dd", "details", "div",
      "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3",
      "h4", "h5", "h6", "header", "hr", "i", "img", "kbd", "li", "main",
      "mark", "nav", "ol", "p", "pre", "q", "s", "section", "small", "span", "style",
      "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
      "thead", "time", "tr", "u", "ul", "var", "script", "canvas", "dialog",
      "fieldset", "form", "input", "label", "legend", "meter", "optgroup", "option",
      "output", "progress", "select", "textarea",
    ],
    allowedAttributes: {
      "*": ["class", "id", "style", "title", "role", "aria-*", "data-*", "on*"],
      a: ["href", "target", "rel"],
      button: ["type", "disabled", "name", "value"],
      canvas: ["width", "height"],
      col: ["span"],
      form: ["method"],
      img: ["src", "alt", "width", "height", "loading"],
      input: ["type", "name", "value", "placeholder", "checked", "disabled", "min", "max", "step"],
      option: ["value", "selected", "disabled"],
      progress: ["value", "max"],
      script: ["type"],
      select: ["name", "disabled", "multiple"],
      td: ["colspan", "rowspan"],
      textarea: ["name", "placeholder", "disabled", "rows", "cols"],
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
  return namespaceArtifactIds(sanitized, scopeId, localIds);
}

export function compileArtifactHtml(input: {
  title: string;
  mode: "document" | "presentation" | "dashboard";
  theme: { visualDirection: string; accent: string; appearance: "light" | "dark" };
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
    return `<section id="${escapeAttribute(planned.id)}" class="artifact-block artifact-block--${escapeAttribute(planned.type)}" data-block-id="${escapeAttribute(planned.id)}"><div class="artifact-block__content"><article class="artifact-content">${compileCharts(bindStaticDataSelectors(parsed.html), accent)}</article></div></section>`;
  });
  const usesEcharts = sections.some((section) => section.includes("data-chart-option") || /\becharts\b/i.test(section));
  const themeGuard = artifactThemeGuardStyles(input.parts);
  const html = [
    "<!doctype html>", '<html lang="zh-CN">', "<head>", '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(input.title)}</title>`, buildArtifactRuntimeHead({ usesEcharts }),
    `  <style>${artifactRuntimeStyles(input.theme.appearance, accent)}</style>`, "</head>",
    `<body class="artifact-shell artifact-shell--${input.mode} artifact-shell--${input.theme.appearance}">`,
    ...sections, `<style data-artifact-theme-guard>${themeGuard}</style>`, buildEChartsScriptExecutionScript(), buildChartHydrationScript(), buildArtifactNavScript(), "</body>", "</html>",
  ].join("\n");
  return { html, partsOk, partsFailed };
}

function artifactThemeGuardStyles(parts: ArtifactPartPlan[]): string {
  const selectors = parts.flatMap((part) => {
    const id = `#${part.id}#${part.id}#${part.id}`;
    return [
      id,
      `${id}>.artifact-block__content`,
      `${id}>.artifact-block__content>.artifact-content`,
      `${id}>.artifact-block__content>.artifact-content>.artifact-block-root`,
    ];
  });
  return `${selectors.join(",")}{background:var(--artifact-bg)!important;background-image:none!important;color:var(--artifact-text)!important}`;
}
function renderErrorSection(part: ArtifactPartPlan, reason: string): string {
  return `<section class="artifact-block artifact-block--${escapeAttribute(part.type)} artifact-block--error" data-block-id="${escapeAttribute(part.id)}"><div class="artifact-block__content"><h2>${escapeHtml(part.title)}</h2><p class="artifact-block__error">本节生成失败：${escapeHtml(reason)}</p></div></section>`;
}
function compileCharts(html: string, accent: string): string {
  const withSpecs = html.replace(/data-chart=(["'])([\s\S]*?)\1/gi, (_match, _quote, raw) => {
    const decoded = decodeAttribute(String(raw));
    let spec: unknown;
    try {
      spec = JSON.parse(decoded);
    } catch {
      return 'data-chart-invalid="true"';
    }
    const option = expandChartSpec(normalizeChartDeep(spec), accent);
    if (!option) return 'data-chart-invalid="true"';
    return `data-chart-option="${escapeAttribute(JSON.stringify(option))}"`;
  });
  return validateChartOptions(withSpecs, accent);
}

const CHART_TYPES = new Set(["bar", "line", "area", "pie", "radar", "tree", "graph", "gantt"]);
type ChartSpec = DiagramChartSpec & {
  type: string;
  title?: unknown;
  categories?: unknown;
  indicators?: unknown;
  series?: unknown;
  stack?: unknown;
  horizontal?: unknown;
  max?: unknown;
};

function expandChartSpec(spec: unknown, accent: string): Record<string, unknown> | null {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const input = spec as ChartSpec;
  const type = typeof input.type === "string" ? input.type.toLowerCase() : "";
  if (!CHART_TYPES.has(type)) return null;
  const palette = chartPalette(accent);
  const title =
    typeof input.title === "string" && input.title.trim()
      ? {
          title: {
            text: normalizeChartText(input.title.trim()),
            left: "center",
            textStyle: { fontSize: 16, fontWeight: 600 },
          },
        }
      : {};

  if (type === "tree" || type === "graph" || type === "gantt") {
    return expandDiagramChartSpec(type, input, title, palette);
  }

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

  if (type === "radar") {
    const defaultMax =
      typeof input.max === "number" && Number.isFinite(input.max) && input.max > 0 ? input.max : 100;
    const indicators = normalizeRadarIndicators(input.categories, input.indicators, defaultMax);
    const seriesData = normalizeRadarSeries(input.series, indicators.length);
    if (!indicators.length || !seriesData.length) return null;
    return {
      color: palette,
      ...title,
      tooltip: { trigger: "item" },
      legend: seriesData.length > 1 ? { bottom: 0 } : undefined,
      radar: { indicator: indicators, radius: "62%" },
      series: [{ type: "radar", data: seriesData }],
    };
  }

  const categories = Array.isArray(input.categories)
    ? input.categories.map((c) => normalizeChartText(String(c)))
    : [];
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
  if (raw.every((v) => typeof v === "number")) {
    return [{ data: raw as number[] }];
  }
  const out: Array<{ name?: string; data: number[] }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!Array.isArray(row.data)) continue;
    const data = row.data.map((n) => (typeof n === "number" ? n : Number(n))).map((n) => (Number.isFinite(n) ? n : 0));
    out.push({
      name: typeof row.name === "string" ? normalizeChartText(row.name) : undefined,
      data,
    });
  }
  return out;
}

function normalizeRadarIndicators(
  categories: unknown,
  indicators: unknown,
  defaultMax: number,
): Array<{ name: string; max: number }> {
  const raw = indicators ?? categories;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item === "string") {
      const name = normalizeChartText(item);
      return name ? [{ name, max: defaultMax }] : [];
    }
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? normalizeChartText(row.name) : "";
    if (!name) return [];
    const max =
      typeof row.max === "number" && Number.isFinite(row.max) && row.max > 0
        ? row.max
        : defaultMax;
    return [{ name, max }];
  });
}

function normalizeRadarSeries(
  raw: unknown,
  indicatorCount: number,
): Array<{ name?: string; value: number[] }> {
  if (!Array.isArray(raw) || indicatorCount <= 0) return [];
  if (raw.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return raw.length === indicatorCount ? [{ value: raw as number[] }] : [];
  }
  const out: Array<{ name?: string; value: number[] }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const source = Array.isArray(row.data)
      ? row.data
      : Array.isArray(row.value)
        ? row.value
        : null;
    if (!source) continue;
    if (
      source.length !== indicatorCount ||
      !source.every((value) => typeof value === "number" && Number.isFinite(value))
    ) continue;
    out.push({
      name: typeof row.name === "string" ? normalizeChartText(row.name) : undefined,
      value: source as number[],
    });
  }
  return out;
}

function normalizePieData(raw: unknown, categories: unknown): Array<{ name: string; value: number }> {
  if (Array.isArray(raw) && raw.every((v) => typeof v === "number") && Array.isArray(categories)) {
    return (raw as number[]).map((value, i) => ({
      name: normalizeChartText(String(categories[i] ?? i)),
      value,
    }));
  }
  if (Array.isArray(raw)) {
    const first = raw[0] as Record<string, unknown> | undefined;
    if (first && Array.isArray(first.data) && Array.isArray(categories)) {
      return (first.data as unknown[]).map((value, i) => ({
        name: normalizeChartText(String(categories[i] ?? i)),
        value: Number(value) || 0,
      }));
    }
    const out: Array<{ name: string; value: number }> = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (row.name == null || row.value == null) continue;
      out.push({ name: normalizeChartText(String(row.name)), value: Number(row.value) || 0 });
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
    const option = coerceEChartsOption(normalizeChartDeep(parsed));
    if (!option || !isBoundedChartOption(option)) return 'data-chart-invalid="true"';
    if (!("color" in option)) option.color = chartPalette(accent);
    if (!("tooltip" in option)) {
      const firstSeries = Array.isArray(option.series) && option.series[0] && typeof option.series[0] === "object"
        ? option.series[0] as Record<string, unknown>
        : undefined;
      option.tooltip = { trigger: firstSeries?.type === "pie" || firstSeries?.type === "radar" ? "item" : "axis" };
    }
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

const NUMERIC_HEX_ENTITY = /&#x([0-9a-fA-F]+);/g;
const NUMERIC_DEC_ENTITY = /&#(\d+);/g;

function decodeHtmlEntities(value: string): string {
  let current = value;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(NUMERIC_HEX_ENTITY, (_match, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _match;
      })
      .replace(NUMERIC_DEC_ENTITY, (_match, dec: string) => {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _match;
      });
    if (next === current) break;
    current = next;
  }
  return current;
}

function decodeAttribute(value: string): string {
  return decodeHtmlEntities(value);
}

function normalizeChartText(value: string): string {
  return decodeHtmlEntities(value);
}

function normalizeChartDeep(value: unknown): unknown {
  if (typeof value === "string") return normalizeChartText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeChartDeep(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizeChartDeep(child);
    }
    return out;
  }
  return value;
}

function normalizeChartOptionJson(value: string): string {
  return value.replace(
    /"formatter"\s*:\s*function\s*\([^)]*\)\s*\{[^{}]*\}/g,
    '"formatter":"{c}"',
  );
}

function artifactRuntimeStyles(appearance: "light" | "dark", accent: string): string {
  const palette = appearance === "dark"
    ? { bg: "#09090b", surface: "#18181b", elevated: "#27272a", text: "#fafafa", muted: "#a1a1aa", border: "#3f3f46" }
    : { bg: "#f8fafc", surface: "#ffffff", elevated: "#f1f5f9", text: "#0f172a", muted: "#475569", border: "#dbe3ee" };
  return [
    "*{box-sizing:border-box;}",
    `:root{color-scheme:${appearance};--artifact-bg:${palette.bg};--artifact-surface:${palette.surface};--artifact-elevated:${palette.elevated};--artifact-text:${palette.text};--artifact-muted:${palette.muted};--artifact-border:${palette.border};--artifact-accent:${accent};--artifact-radius:clamp(12px,1.5vw,22px);--artifact-gap:clamp(16px,2.4vw,32px);--artifact-gutter:clamp(16px,4vw,64px);--artifact-content-width:1440px;}`,
    "html,body{margin:0;min-height:100%;background:var(--artifact-bg);color:var(--artifact-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;line-height:1.55;text-rendering:optimizeLegibility;}",
    "body{overflow-x:hidden;}",
    ".artifact-block{position:relative;min-width:0;}",
    ".artifact-block__content{width:min(100%,var(--artifact-content-width));min-width:0;margin-inline:auto;padding:clamp(24px,5vw,80px) var(--artifact-gutter);overflow-wrap:anywhere;}",
    ".artifact-content{min-width:0;}",
    ".artifact-shell--document .artifact-block+.artifact-block{border-top:1px solid var(--artifact-border);}",
    ".artifact-shell--presentation .artifact-block{display:grid;align-items:center;min-height:min(100svh,900px);}",
    ".artifact-shell--dashboard .artifact-block__content{width:min(100%,1600px);}",
    ".artifact-stack{display:flex;min-width:0;flex-direction:column;flex-wrap:nowrap;gap:var(--artifact-gap);}",
    ".artifact-cluster{display:flex;min-width:0;flex-wrap:wrap;align-items:center;gap:clamp(8px,1.5vw,16px);}",
    ".artifact-grid,.artifact-metric-grid{display:grid;min-width:0;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:var(--artifact-gap);}",
    ".artifact-metric-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));}",
    ".artifact-split{display:grid;min-width:0;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));align-items:center;gap:clamp(24px,5vw,72px);}",
    ".artifact-card{min-width:0;padding:clamp(16px,2.5vw,32px);border:1px solid var(--artifact-border);border-radius:var(--artifact-radius);background:var(--artifact-surface);box-shadow:0 12px 32px color-mix(in srgb,var(--artifact-text) 8%,transparent);}",
    ".artifact-frame{min-width:0;overflow:hidden;border-radius:var(--artifact-radius);background:var(--artifact-elevated);}",
    ".artifact-table-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;-webkit-overflow-scrolling:touch;}",
    ".artifact-table-scroll table{width:100%;min-width:min(640px,100%);border-collapse:collapse;}",
    ".artifact-prose{max-width:75ch;}",
    "h1,h2,h3,h4,h5,h6{margin-block:0 .5em;line-height:1.15;letter-spacing:-.02em;text-wrap:balance;}",
    "h1{font-size:clamp(2rem,6vw,4.75rem);}h2{font-size:clamp(1.6rem,4vw,3rem);}h3{font-size:clamp(1.25rem,2.5vw,2rem);}",
    "p,li,td,th{font-size:clamp(.95rem,1.3vw,1.08rem);}p{max-width:75ch;}",
    "a{color:var(--artifact-accent);text-underline-offset:.18em;}",
    "pre{max-width:100%;overflow:auto;padding:1em;border-radius:calc(var(--artifact-radius)*.65);background:var(--artifact-elevated);}",
    "table{max-width:100%;}th,td{padding:.75em 1em;border-bottom:1px solid var(--artifact-border);text-align:start;}",
    "img,svg,canvas{max-width:100%;height:auto;}",
    "[data-chart-option]{min-height:clamp(280px,45vw,520px);width:100%;max-width:100%;}",
    "[data-chart-invalid]{min-height:auto;}",
    ".artifact-block--error{padding:24px;border:1px solid #fecaca;background:#fef2f2;}",
    ".artifact-block__error{color:#b91c1c;font-weight:600;}",
    "@media(max-width:640px){.artifact-block__content{padding-block:clamp(20px,7vw,40px)}.artifact-card{box-shadow:none}.artifact-shell--presentation .artifact-block{min-height:auto}}",
    "@media print{.artifact-block{break-after:page}.artifact-card{box-shadow:none}}",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string { return escapeHtml(value).replace(/'/g, "&#39;"); }
