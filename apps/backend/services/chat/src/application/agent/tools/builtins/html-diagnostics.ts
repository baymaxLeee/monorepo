import { createHash } from "node:crypto";
import path from "node:path";
import { Script } from "node:vm";

import { parseDocument } from "htmlparser2";
import postcss from "postcss";

export type HtmlDiagnosticFinding = {
  code: string;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
  actionable: boolean;
};

export type HtmlDiagnosticReport = {
  ok: boolean;
  content_sha256: string;
  findings: HtmlDiagnosticFinding[];
};

type NodeLike = {
  name?: string;
  tagName?: string;
  attribs?: Record<string, string>;
  children?: NodeLike[];
  data?: string;
};

function nodes(root: NodeLike): NodeLike[] {
  const result: NodeLike[] = [];
  const visit = (node: NodeLike): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}

function elements(root: NodeLike, tag?: string): NodeLike[] {
  return nodes(root).filter((node) => {
    const name = (node.tagName ?? node.name)?.toLowerCase();
    return Boolean(name) && (tag == null || name === tag);
  });
}

function text(node: NodeLike): string {
  return (node.children ?? []).map((child) => child.data ?? text(child)).join("");
}

function finding(
  code: string,
  severity: "error" | "warning",
  message: string,
  suggestion: string,
): HtmlDiagnosticFinding {
  return {
    code,
    severity,
    message,
    suggestion,
    actionable: severity === "error",
  };
}

function inspectCss(css: string): HtmlDiagnosticFinding[] {
  try {
    postcss.parse(css);
    return [];
  } catch (error) {
    return [
      finding(
        "CSS_PARSE_ERROR",
        "error",
        `CSS cannot be parsed: ${String(error)}`,
        "Fix the malformed CSS declaration or rule.",
      ),
    ];
  }
}

function inspectClassicScript(source: string): HtmlDiagnosticFinding[] {
  if (!source.trim()) return [];
  try {
    new Script(source);
    return [];
  } catch (error) {
    return [
      finding(
        "SCRIPT_SYNTAX_ERROR",
        "error",
        `Inline JavaScript cannot be parsed: ${String(error)}`,
        "Fix the JavaScript syntax before running the page.",
      ),
    ];
  }
}

function localReference(
  sourcePath: string,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    trimmed.startsWith("//")
  ) {
    return null;
  }
  const reference = trimmed.split(/[?#]/, 1)[0];
  if (!reference) return null;
  return path.posix
    .normalize(path.posix.join(path.posix.dirname(sourcePath), reference))
    .replace(/^\/+/, "");
}

export function diagnoseHtml(
  html: string,
  options: {
    sourcePath?: string;
    availablePaths?: ReadonlySet<string>;
  } = {},
): HtmlDiagnosticReport {
  const root = parseDocument(html, {
    lowerCaseAttributeNames: false,
  }) as unknown as NodeLike;
  const allElements = elements(root);
  const findings: HtmlDiagnosticFinding[] = [];

  if (!/^\s*<!doctype html>/i.test(html)) {
    findings.push(
      finding(
        "DOCUMENT_DOCTYPE_MISSING",
        "warning",
        "Document is missing <!doctype html>.",
        "Add <!doctype html> for standards-mode rendering.",
      ),
    );
  }

  const htmlElements = elements(root, "html");
  const bodyElements = elements(root, "body");
  if (htmlElements.length !== 1 || bodyElements.length !== 1) {
    findings.push(
      finding(
        "DOCUMENT_ROOT_INVALID",
        "error",
        "Document must contain exactly one html element and one body element.",
        "Return one complete HTML document.",
      ),
    );
  }

  const ids = new Map<string, number>();
  for (const element of allElements) {
    const id = element.attribs?.id;
    if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  for (const [id, count] of ids) {
    if (count > 1) {
      findings.push(
        finding(
          "DOCUMENT_DUPLICATE_ID",
          "error",
          `ID "${id}" appears ${count} times.`,
          "Rename or remove duplicate IDs.",
        ),
      );
    }
  }

  for (const anchor of elements(root, "a")) {
    const href = anchor.attribs?.href ?? "";
    if (!href.startsWith("#") || href.length === 1) continue;
    let target = "";
    try {
      target = decodeURIComponent(href.slice(1));
    } catch {
      target = "";
    }
    if (!target || !ids.has(target)) {
      findings.push(
        finding(
          "NAV_BROKEN_INTERNAL_LINK",
          "error",
          `Internal link ${href} has no target.`,
          "Point the link at an existing element ID.",
        ),
      );
    }
  }

  for (const style of elements(root, "style")) {
    findings.push(...inspectCss(text(style)));
  }
  for (const element of allElements) {
    const inlineStyle = element.attribs?.style;
    if (inlineStyle) findings.push(...inspectCss(`a{${inlineStyle}}`));
  }

  for (const script of elements(root, "script")) {
    const type = script.attribs?.type?.toLowerCase() ?? "";
    if (
      script.attribs?.src ||
      type === "module" ||
      type === "application/json" ||
      type === "application/ld+json"
    ) {
      continue;
    }
    findings.push(...inspectClassicScript(text(script)));
  }

  if (options.sourcePath && options.availablePaths) {
    for (const element of allElements) {
      const tag = (element.tagName ?? element.name)?.toLowerCase();
      const attribute = tag === "link" || tag === "a" ? "href" : "src";
      const value = element.attribs?.[attribute];
      if (!value) continue;
      const target = localReference(options.sourcePath, value);
      if (target && !options.availablePaths.has(target)) {
        findings.push(
          finding(
            "RESOURCE_LOCAL_TARGET_MISSING",
            "error",
            `Local resource ${value} does not exist.`,
            `Create ${target} or update the ${attribute} reference.`,
          ),
        );
      }
    }
  }

  return {
    ok: findings.every((item) => !item.actionable),
    content_sha256: createHash("sha256").update(html).digest("hex"),
    findings,
  };
}
