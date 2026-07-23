import { createHash } from "node:crypto";

import { parseDocument } from "htmlparser2";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export type HtmlValidationSeverity = "error" | "warning" | "info";
export type HtmlValidationCategory =
  | "structure"
  | "security"
  | "template"
  | "responsive"
  | "accessibility"
  | "navigation"
  | "chart"
  | "content"
  | "coherence"
  | "visual";

export type HtmlValidationFinding = {
  code: string;
  severity: HtmlValidationSeverity;
  category: HtmlValidationCategory;
  message: string;
  suggestion: string;
  source: "static" | "model";
  actionable: boolean;
  block_id?: string;
  selector?: string;
  evidence?: { kind: "html" | "css"; excerpt: string };
};

export type HtmlValidationReport = {
  ok: boolean;
  content_sha256: string;
  summary: { errors: number; warnings: number; infos: number };
  findings: HtmlValidationFinding[];
  metrics: {
    blocks: number;
    charts: number;
    internal_links: number;
    total_chars: number;
  };
};

type NodeLike = {
  type?: string;
  name?: string;
  tagName?: string;
  attribs?: Record<string, string>;
  children?: NodeLike[];
  parent?: NodeLike | null;
  data?: string;
};

const BLOCK_CLASS = "artifact-block";
function nodes(root: NodeLike): NodeLike[] {
  const out: NodeLike[] = [];
  const visit = (node: NodeLike): void => {
    out.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

function elements(root: NodeLike, tag?: string): NodeLike[] {
  return nodes(root).filter((node) => {
    const nodeTag = node.tagName ?? node.name;
    return Boolean(nodeTag) && (tag == null || nodeTag?.toLowerCase() === tag);
  });
}

function classes(node: NodeLike): string[] {
  return (node.attribs?.class ?? "").split(/\s+/).filter(Boolean);
}

function closestBlockId(node: NodeLike): string | undefined {
  for (let current: NodeLike | null | undefined = node; current; current = current.parent) {
    if (classes(current).includes(BLOCK_CLASS)) return current.attribs?.["data-block-id"];
  }
  return undefined;
}

function excerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function finding(
  code: string,
  severity: HtmlValidationSeverity,
  category: HtmlValidationCategory,
  message: string,
  suggestion: string,
  options: Pick<HtmlValidationFinding, "block_id" | "selector" | "evidence"> = {},
): HtmlValidationFinding {
  return {
    code,
    severity,
    category,
    message,
    suggestion,
    source: "static",
    actionable: severity === "error",
    ...options,
  };
}

export function mergeArtifactValidationFindings(
  report: HtmlValidationReport,
  findings: HtmlValidationFinding[],
): HtmlValidationReport {
  const merged = [...report.findings, ...findings];
  const summary = {
    errors: merged.filter((item) => item.severity === "error").length,
    warnings: merged.filter((item) => item.severity === "warning").length,
    infos: merged.filter((item) => item.severity === "info").length,
  };
  return {
    ...report,
    ok: !merged.some((item) => item.actionable),
    summary,
    findings: merged,
  };
}

function inspectCss(css: string, blockId: string | undefined, enforceScope = true): HtmlValidationFinding[] {
  const findings: HtmlValidationFinding[] = [];
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    return [
      finding(
        "CSS_PARSE_ERROR",
        "error",
        "structure",
        `CSS cannot be parsed: ${String(error)}`,
        "Return valid CSS and remove the malformed declaration or rule.",
        { block_id: blockId, evidence: { kind: "css", excerpt: excerpt(css) } },
      ),
    ];
  }

  root.walkAtRules((rule) => {
    if (["import", "namespace", "font-face", "page"].includes(rule.name.toLowerCase())) {
      findings.push(
        finding(
          "CSS_FORBIDDEN_AT_RULE",
          "error",
          "security",
          `@${rule.name} is not allowed in artifact blocks.`,
          "Use the platform-provided fonts and styles without external CSS resources.",
          { block_id: blockId, evidence: { kind: "css", excerpt: excerpt(rule.toString()) } },
        ),
      );
    }
  });

  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    if (blockId && enforceScope) {
      try {
        const parsed = selectorParser().astSync(rule.selector);
        const unscoped = parsed.nodes.some((selector) => {
          const first = selector.nodes[0];
          return first?.type !== "id" || first.value !== blockId;
        });
        if (unscoped) {
          findings.push(
            finding(
              "CSS_SELECTOR_NOT_SCOPED",
              "error",
              "template",
              `Selector is not scoped to #${blockId}.`,
              `Prefix every selector with #${blockId}.`,
              { block_id: blockId, selector: rule.selector, evidence: { kind: "css", excerpt: rule.selector } },
            ),
          );
        }
      } catch {
        findings.push(
          finding(
            "CSS_SELECTOR_INVALID",
            "error",
            "structure",
            "A CSS selector cannot be parsed.",
            "Replace it with a valid selector scoped to the current block.",
            { block_id: blockId, selector: rule.selector, evidence: { kind: "css", excerpt: rule.selector } },
          ),
        );
      }
    }

    const declarations = new Map<string, string>();
    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop.toLowerCase(), declaration.value);
    });
    const position = declarations.get("position")?.toLowerCase();
    if (position === "fixed") {
      findings.push(
        finding(
          "CSS_FIXED_POSITION",
          "error",
          "responsive",
          "Fixed positioning can cover content and escape the artifact viewport.",
          "Use normal flow, Grid, Flexbox, or sticky positioning inside the block.",
          { block_id: blockId, selector: rule.selector },
        ),
      );
    }
    const minWidth = declarations.get("min-width");
    const minWidthPx = minWidth?.match(/^([0-9.]+)px$/i);
    if (minWidthPx && Number(minWidthPx[1]) > 480) {
      findings.push(
        finding(
          "CSS_RIGID_MIN_WIDTH",
          "warning",
          "responsive",
          `${rule.selector} has a rigid min-width of ${minWidth}.`,
          "Use min-width:0, max-width:100%, or min()/clamp() so the element fits narrow viewports.",
          { block_id: blockId, selector: rule.selector, evidence: { kind: "css", excerpt: `min-width:${minWidth}` } },
        ),
      );
    }
    const grid = declarations.get("grid-template-columns") ?? "";
    if (/\b[4-9]\d{2,}px\b/i.test(grid) && !/auto-fit|auto-fill|minmax|min\(/i.test(grid)) {
      findings.push(
        finding(
          "CSS_RIGID_GRID_TRACK",
          "warning",
          "responsive",
          `${rule.selector} uses large fixed grid tracks.`,
          "Use repeat(auto-fit, minmax(min(100%, ...), 1fr)) or a platform artifact-grid primitive.",
          { block_id: blockId, selector: rule.selector, evidence: { kind: "css", excerpt: `grid-template-columns:${grid}` } },
        ),
      );
    }
    if (declarations.get("display")?.toLowerCase() === "flex" && !declarations.has("flex-wrap")) {
      findings.push(
        finding(
          "CSS_FLEX_WRAP_UNSPECIFIED",
          "warning",
          "responsive",
          `${rule.selector} is a flex container without an explicit wrapping policy.`,
          "Use the artifact-cluster primitive or set flex-wrap when children must adapt on narrow screens.",
          { block_id: blockId, selector: rule.selector },
        ),
      );
    }
    if (declarations.get("white-space")?.toLowerCase() === "nowrap") {
      findings.push(
        finding(
          "CSS_NOWRAP_CONTENT",
          "warning",
          "responsive",
          `${rule.selector} prevents text wrapping.`,
          "Remove white-space:nowrap or place the content in an intentional horizontal scroll container.",
          { block_id: blockId, selector: rule.selector },
        ),
      );
    }
  });
  return findings;
}

function inspectElements(root: NodeLike, defaultBlockId?: string): HtmlValidationFinding[] {
  const findings: HtmlValidationFinding[] = [];
  for (const element of elements(root)) {
    const tag = (element.tagName ?? element.name ?? "").toLowerCase();
    const attrs = element.attribs ?? {};
    const blockId = closestBlockId(element) ?? defaultBlockId;
    const htmlEvidence = { kind: "html" as const, excerpt: excerpt(`<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}>`) };
    if (Object.values(attrs).some((value) => /javascript\s*:/i.test(value))) {
      findings.push(finding("HTML_JAVASCRIPT_URL", "error", "security", `JavaScript URL found on <${tag}>.`, "Use an ordinary https or fragment URL.", { block_id: blockId, evidence: htmlEvidence }));
    }
    if (tag === "img" && !("alt" in attrs)) {
      findings.push(finding("A11Y_IMAGE_ALT_MISSING", "error", "accessibility", "Image is missing an alt attribute.", "Add concise alt text, or alt=\"\" for a decorative image.", { block_id: blockId, evidence: htmlEvidence }));
    }
    if (tag === "button" && !attrs.type) {
      findings.push(finding("A11Y_BUTTON_TYPE_MISSING", "warning", "accessibility", "Button has no explicit type.", "Add type=\"button\" unless it intentionally submits a form.", { block_id: blockId, evidence: htmlEvidence }));
    }
    if (tag === "a" && (!attrs.href || attrs.href === "#")) {
      findings.push(finding("NAV_EMPTY_LINK", "warning", "navigation", "Link has no usable destination.", "Provide a valid fragment target or https URL.", { block_id: blockId, evidence: htmlEvidence }));
    }
    if (tag === "style") findings.push(...inspectCss((element.children ?? []).map((child) => child.data ?? "").join(""), blockId));
    if (attrs.style) findings.push(...inspectCss(`.__inline__{${attrs.style}}`, blockId, false).map((item) => ({ ...item, selector: `<${tag}>` })));
  }
  for (const table of elements(root, "table")) {
    if (!elements(table, "th").length) {
      findings.push(finding("A11Y_TABLE_HEADERS_MISSING", "warning", "accessibility", "Table has no header cells.", "Use <th scope=\"col\"> or <th scope=\"row\"> so the data remains understandable.", { block_id: closestBlockId(table) ?? defaultBlockId }));
    }
    if (!classes(table.parent ?? {}).includes("artifact-table-scroll")) {
      findings.push(finding("RESPONSIVE_TABLE_WRAPPER_MISSING", "error", "responsive", "Table is not inside the platform scroll container.", "Wrap the table in <div class=\"artifact-table-scroll\">...</div>.", { block_id: closestBlockId(table) ?? defaultBlockId }));
    }
  }
  return findings;
}

function chartTextHasEntityLiteral(value: string): boolean {
  return /&#(?:x[0-9a-fA-F]+|\d+);/.test(value);
}

function inspectChartTextEntities(root: NodeLike): HtmlValidationFinding[] {
  const findings: HtmlValidationFinding[] = [];
  for (const element of elements(root)) {
    const attrs = element.attribs ?? {};
    const optionRaw = attrs["data-chart-option"];
    if (!optionRaw) continue;
    const blockId = closestBlockId(element);
    let parsed: unknown;
    try {
      parsed = JSON.parse(optionRaw);
    } catch {
      continue;
    }
    const visit = (value: unknown): void => {
      if (typeof value === "string" && chartTextHasEntityLiteral(value)) {
        findings.push(
          finding(
            "CHART_TEXT_ENTITY_LITERAL",
            "error",
            "chart",
            "Chart text still contains HTML entity literals.",
            "Use plain Unicode text in chart labels and tooltips; the compiler decodes entities automatically.",
            { block_id: blockId, evidence: { kind: "html", excerpt: excerpt(value) } },
          ),
        );
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (value && typeof value === "object") {
        for (const child of Object.values(value as Record<string, unknown>)) visit(child);
      }
    };
    visit(parsed);
  }
  return findings;
}

function report(html: string, findings: HtmlValidationFinding[], metrics: HtmlValidationReport["metrics"]): HtmlValidationReport {
  const summary = {
    errors: findings.filter((item) => item.severity === "error").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
    infos: findings.filter((item) => item.severity === "info").length,
  };
  return {
    ok: summary.errors === 0,
    content_sha256: createHash("sha256").update(html).digest("hex"),
    summary,
    findings,
    metrics,
  };
}

export function validateArtifactHtml(html: string): HtmlValidationReport {
  const root = parseDocument(html, { lowerCaseAttributeNames: false }) as unknown as NodeLike;
  const allElements = elements(root);
  const findings = inspectElements(root);
  if (!/^\s*<!doctype html>/i.test(html)) findings.push(finding("DOCUMENT_DOCTYPE_MISSING", "error", "structure", "Document is missing <!doctype html>.", "Compile the artifact with the platform document shell."));
  const htmlElements = elements(root, "html");
  const bodies = elements(root, "body");
  if (htmlElements.length !== 1 || bodies.length !== 1) findings.push(finding("DOCUMENT_ROOT_INVALID", "error", "structure", "Document must contain exactly one html and one body element.", "Use the compiler-owned document shell and return fragments from block generation."));
  const body = bodies[0];
  if (!body || !classes(body).includes("artifact-shell")) {
    findings.push(finding("TEMPLATE_SHELL_INVALID", "error", "template", "Document is not using the current artifact shell.", "Regenerate the artifact with the current platform template."));
  }

  const ids = new Map<string, NodeLike[]>();
  for (const element of allElements) {
    const id = element.attribs?.id;
    if (id) ids.set(id, [...(ids.get(id) ?? []), element]);
  }
  for (const [id, matches] of ids) {
    if (matches.length > 1) findings.push(finding("DOCUMENT_DUPLICATE_ID", "error", "structure", `ID \"${id}\" appears ${matches.length} times.`, "Prefix block-local IDs or remove the duplicate ID.", { block_id: closestBlockId(matches[1]!), selector: `#${id}` }));
  }
  for (const anchor of elements(root, "a")) {
    const href = anchor.attribs?.href ?? "";
    let target = href.slice(1);
    try {
      target = decodeURIComponent(target);
    } catch {
      target = "";
    }
    if (href.startsWith("#") && href.length > 1 && (!target || !ids.has(target))) {
      findings.push(finding("NAV_BROKEN_INTERNAL_LINK", "error", "navigation", `Internal link ${href} has no target.`, "Point the link at one of the block IDs from the outline.", { block_id: closestBlockId(anchor), evidence: { kind: "html", excerpt: href } }));
    }
  }

  const blocks = allElements.filter((element) => classes(element).includes(BLOCK_CLASS));
  for (const block of blocks) {
    const blockId = block.attribs?.["data-block-id"];
    if (!blockId || block.attribs?.id !== blockId) findings.push(finding("TEMPLATE_BLOCK_ID_INVALID", "error", "template", "Artifact block id and data-block-id must match.", "Let the compiler own the outer block element and its stable ID.", { block_id: blockId }));
    if (classes(block).includes("artifact-block--error")) findings.push(finding("BLOCK_GENERATION_FAILED", "error", "structure", "A generated block contains an error placeholder.", "Regenerate this block successfully before publishing.", { block_id: blockId }));
  }
  if (!blocks.length) findings.push(finding("TEMPLATE_BLOCKS_MISSING", "error", "template", "Document contains no artifact blocks.", "Compile at least one planned block into the artifact shell."));
  for (const invalidChart of allElements.filter((element) => "data-chart-invalid" in (element.attribs ?? {}))) {
    findings.push(finding(
      "CHART_INVALID",
      "error",
      "chart",
      "A chart specification is invalid (compiler marked data-chart-invalid).",
      "For bar, line, area, pie, or radar, replace the chart with a data-chart shorthand div instead of hand-writing data-chart-option. Radar uses categories (indicator names) and series [{name, data:number[]}]. Escape inner quotes as &quot;. Use a corrected data-chart-option only for chart types the shorthand cannot express.",
      { block_id: closestBlockId(invalidChart) },
    ));
  }
  for (const chart of allElements.filter((element) => "data-chart-option" in (element.attribs ?? {}))) {
    const raw = chart.attribs?.["data-chart-option"];
    try {
      const option = JSON.parse(raw ?? "") as Record<string, unknown>;
      if (!option.tooltip || typeof option.tooltip !== "object") {
        findings.push(finding(
          "CHART_TOOLTIP_MISSING",
          "error",
          "chart",
          "Chart hover details are unavailable because tooltip configuration is missing.",
          "Add an ECharts tooltip with trigger:item for pie/radar charts or trigger:axis for cartesian charts.",
          { block_id: closestBlockId(chart), evidence: { kind: "html", excerpt: excerpt(raw ?? "") } },
        ));
      }
    } catch {
      // CHART_INVALID owns malformed options.
    }
  }
  findings.push(...inspectChartTextEntities(root));

  return report(html, findings, {
    blocks: blocks.length,
    charts: allElements.filter((element) => "data-chart-option" in (element.attribs ?? {})).length,
    internal_links: elements(root, "a").filter((element) => element.attribs?.href?.startsWith("#")).length,
    total_chars: html.length,
  });
}
