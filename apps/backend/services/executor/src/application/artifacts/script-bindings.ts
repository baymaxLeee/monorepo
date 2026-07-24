import { DomUtils, parseDocument } from "htmlparser2";

type HtmlNode = {
  type?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  data?: string;
};

function htmlNodes(root: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = [];
  const visit = (node: HtmlNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}

export function bindStaticDataSelectors(value: string): string {
  const root = parseDocument(value, { lowerCaseAttributeNames: false }) as unknown as HtmlNode;
  const nodes = htmlNodes(root);
  const requested = new Set<string>();
  const existing = new Set<string>();
  for (const node of nodes) {
    for (const name of Object.keys(node.attribs ?? {})) {
      if (name.startsWith("data-")) existing.add(name);
    }
    if (node.type !== "script") continue;
    const source = (node.children ?? []).map((child) => child.data ?? "").join("");
    for (const call of source.matchAll(/querySelector(?:All)?\(\s*(['"])(.*?)\1\s*\)/g)) {
      for (const attribute of call[2]?.matchAll(/\[\s*(data-[a-z0-9_-]+)(?:\s*[~|^$*]?=|\s*\])/gi) ?? []) {
        if (attribute[1]) requested.add(attribute[1].toLowerCase());
      }
    }
  }
  for (const attribute of requested) {
    if (existing.has(attribute)) continue;
    const localId = attribute.slice("data-".length);
    const targets = nodes.filter((node) => {
      const id = node.attribs?.id;
      return id === localId || id?.endsWith(`--${localId}`);
    });
    if (targets.length === 1) targets[0]!.attribs![attribute] = "";
  }
  return DomUtils.getInnerHTML(root as never).trim();
}
