import { buildArtifactRuntimeHead, buildChartHydrationScript } from "./agent-artifacts.js";

export type ArtifactPartPlan = { id: string; type: string; title: string };

export function sanitizeArtifactPart(value: string): string {
  return value
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .trim();
}

export function compileArtifactHtml(input: {
  title: string;
  mode: "document" | "presentation" | "dashboard";
  theme: { preset: string; accent: string };
  parts: ArtifactPartPlan[];
  stored: Array<{ id: string; content: string }>;
}): { html: string; partsOk: number; partsFailed: number } {
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
    return `<section class="artifact-block artifact-block--${escapeAttribute(planned.type)}" data-block-id="${escapeAttribute(planned.id)}"><div class="artifact-block__content">${validateChartOptions(parsed.html)}</div></section>`;
  });
  const usesEcharts = input.mode === "dashboard" || sections.some((section) => section.includes("data-chart-option"));
  const html = [
    "<!doctype html>", '<html lang="zh-CN">', "<head>", '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(input.title)}</title>`, buildArtifactRuntimeHead({ usesEcharts }),
    `  <style>${artifactModeStyles(input.mode, input.theme.accent)}</style>`, "</head>", "<body>",
    ...sections, buildChartHydrationScript(), "</body>", "</html>",
  ].join("\n");
  return { html, partsOk, partsFailed };
}

function renderErrorSection(part: ArtifactPartPlan, reason: string): string {
  return `<section class="artifact-block artifact-block--${escapeAttribute(part.type)} artifact-block--error" data-block-id="${escapeAttribute(part.id)}"><div class="artifact-block__content"><h2>${escapeHtml(part.title)}</h2><p class="artifact-block__error">本节生成失败：${escapeHtml(reason)}</p></div></section>`;
}

function validateChartOptions(html: string): string {
  return html.replace(/data-chart-option=(["'])([\s\S]*?)\1/gi, (match, _quote, raw) => {
    const decoded = String(raw).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    try { JSON.parse(decoded); return match; } catch { return 'data-chart-invalid="true"'; }
  });
}

function artifactModeStyles(mode: "document" | "presentation" | "dashboard", rawAccent: string): string {
  const accent = /^#[0-9a-f]{3,8}$/i.test(rawAccent) ? rawAccent : "#2563eb";
  const base = [
    `:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; --accent: ${accent}; }`,
    "* { box-sizing: border-box; } body { margin: 0; background: #eef1f5; color: #111827; }",
    ".artifact-block__content { max-width: 100%; overflow-wrap: anywhere; }",
    "img, svg, canvas { max-width: 100%; } table { width: 100%; border-collapse: collapse; } th, td { padding: 10px; border: 1px solid #d1d5db; }",
    "[data-chart-option] { min-height: 360px; }",
    ".artifact-block--error { border: 1px solid #fecaca; } .artifact-block__error { color: #b91c1c; font-weight: 600; }",
    "@media print { body { background: white; } .artifact-block { width: 100%; margin: 0; border-radius: 0; box-shadow: none; } }",
  ];
  if (mode === "presentation") base.push(".artifact-block { width: min(1280px, calc(100% - 32px)); aspect-ratio: 16 / 9; min-height: 720px; margin: 24px auto; padding: 64px; background: white; border-radius: 16px; box-shadow: 0 8px 30px #0f172a14; break-after: page; display: flex; flex-direction: column; justify-content: center; }");
  else if (mode === "dashboard") base.push("body { background: #0b1120; color: #e5e7eb; }", ".artifact-block { width: min(1280px, calc(100% - 32px)); margin: 16px auto; padding: 24px; background: #111827; border: 1px solid #1f2937; border-radius: 12px; }", ".artifact-block__content { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }");
  else base.push(".artifact-block { width: min(1120px, calc(100% - 32px)); min-height: 640px; margin: 24px auto; padding: 64px; background: white; border-radius: 16px; box-shadow: 0 8px 30px #0f172a14; break-after: page; }");
  return base.join(" ");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string { return escapeHtml(value).replace(/'/g, "&#39;"); }
