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
