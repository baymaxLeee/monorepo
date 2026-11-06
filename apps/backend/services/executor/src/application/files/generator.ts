import { createProviderModel, type LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { streamText } from "ai";

import { getProvider } from "../../infrastructure/clients/admin.js";

const FILE_GENERATION_TIMEOUT = {
  totalMs: 30 * 60_000,
  stepMs: 30 * 60_000,
  chunkMs: 5 * 60_000,
} as const;

export async function buildFileTextModel(providerId: string, tenantId: string, workspaceId: string) {
  const snapshot = await getProvider(providerId, tenantId, workspaceId);
  const provider: LanguageProviderSnapshot = snapshot;
  const model = createProviderModel(provider);
  return { model, maxOutputTokens: provider.maxOutputTokens };
}

async function collectText(result: { textStream: AsyncIterable<string> }): Promise<string> {
  let raw = "";
  for await (const delta of result.textStream) {
    raw += delta;
  }
  return raw;
}

function stripFence(value: string): string {
  return value
    .trim()
    .replace(/^```[a-z0-9_-]*\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function fileInstructions(outputPath: string): string {
  const htmlInstructions = [
    "HTML retains the complete browser runtime. Use scripts, modules, dynamic DOM, events, Canvas, SVG, WebGL, forms, media, workers, and external libraries whenever the task asks for them.",
    "Deliver browser dependencies with the artifact. Installing or downloading a library in the execution environment does not provide it to the viewer. For libraries without a documented platform runtime, prefer bundling installed, version-pinned JS and inlining required CSS/assets when feasible, including transitive imports, CSS url() resources, fonts, workers and WASM. Saving one HTML does not publish sandbox-relative files. Never invent /runtime URLs or promise offline support while mandatory external resources remain; provide usable local fallbacks for optional fonts/styles.",
    "If external resources are necessary, use versioned URLs, appropriate CORS/integrity attributes for an isolated iframe, and wait for readiness before any dependent code runs. Show load failure visibly while keeping the rest of the report usable. Verify cold/delayed resource loading and blocked external CDN access in an available real browser; downloads, syntax checks and preloaded DOM mocks alone do not prove rendering. State any missing browser validation honestly.",
    "When charts are needed, default to Apache ECharts and write complete ECharts options, initialization, interactions, and responsive behavior directly in this file. Do not use a chart DSL, data-chart attributes, or another chart library unless the task explicitly requires it or ECharts cannot implement it.",
    "Load ECharts exactly once through one page-global cached Promise such as window.__echartsReady. HTML previews use signed HTTP URLs in an opaque-origin iframe; legacy previews may use blob: URLs. Try /runtime/echarts/6.1.0/echarts.min.js first, constructing the absolute URL from window.location.origin when it is an http(s) URL origin; do not resolve it against document.baseURI or read the parent window. If that candidate fails or does not expose window.echarts, sequentially load https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js. An offline CDN must not prevent charts when the platform runtime loads.",
    "Before assigning src and appending EVERY ECharts script, including the platform candidate, set integrity=sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD, crossOrigin=anonymous, and referrerPolicy=no-referrer. Never condition these attributes on a CDN URL: the isolated iframe also makes platform requests cross-origin. Remove a failed script before trying the next candidate. Resolve only after window.echarts exists, reject after all candidates fail, catch the rejection to render a visible chart error, and never add duplicate or racing loaders.",
    "Put ALL ECharts API access inside the fulfilled loader callback, including registerTheme, registerMap, graphic constructors, init, and setOption: window.__echartsReady.then(function (echarts) { echarts.registerTheme(...); /* initialize charts here */ }).catch(showChartError). A top-level API call before loading aborts the script before that callback is attached. Validate with window.echarts initially absent and delayed script completion: platform-only success, platform failure followed by CDN success, and visible failure when both fail. Pre-injecting ECharts before evaluating the document does not test the loader.",
    "Build chart layouts with CSS Grid or Flexbox so panels reflow with the viewport. Prefer width:100%, min-width:0, minmax(0,1fr), auto-fit/auto-fill, gap, and clamp() responsive dimensions; avoid rigid pixel widths, fixed positioning, or nowrap layouts that can overflow.",
    "Elastic layout must not collapse chart usability. Give every chart a real non-zero responsive height, and make its card or grid track establish a content-appropriate minimum height before the chart uses flex:1 and min-height:0. In long or multi-row dashboards, use minmax() tracks with a usable minimum plus align-content:start and let the document scroll; never squeeze all charts into one viewport with equal fractional auto-rows. Use spans only when information layout requires them, never duplicate a filler chart, and give each logical chart one unique DOM container.",
    "Initialize only after the Promise resolves, register each ECharts instance as it is created, and observe its actual chart.getDom() container with ResizeObserver. Coalesce resize work with requestAnimationFrame when necessary, call chart.resize() after the first layout frame, and keep window resize only as a fallback.",
  ].join("\n");
  return [
    `Materialize the exact complete UTF-8 contents of ${outputPath}.`,
    "Return only file contents without a markdown fence.",
    /\.html?$/i.test(outputPath) ? htmlInstructions : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateFileContent(input: {
  outputPath: string;
  taskId: string;
  sharedContext: string;
  instruction: string;
  tools: Awaited<ReturnType<typeof buildFileTextModel>>;
  abortSignal: AbortSignal;
}): Promise<string> {
  const result = streamText({
    model: input.tools.model,
    maxOutputTokens: input.tools.maxOutputTokens,
    instructions: fileInstructions(input.outputPath),
    prompt: ["<shared_context>", input.sharedContext, "</shared_context>", "<task>", input.instruction, "</task>"].join(
      "\n",
    ),
    timeout: FILE_GENERATION_TIMEOUT,
    abortSignal: input.abortSignal,
  });
  const raw = await collectText(result);
  const content = stripFence(raw);
  if (!content) {
    throw new Error(`task ${input.taskId} produced empty file content`);
  }
  return content;
}
