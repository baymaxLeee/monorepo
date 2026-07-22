import { APICallError, streamText } from "ai";

import { getProvider } from "../../infrastructure/clients/admin.js";
import { createProviderModel, type ChatProvider } from "@backend/transport-ts/provider-model";
import { sanitizeArtifactPart, ARTIFACT_VISUAL_CAPABILITIES, ARTIFACT_CHART_SPEC } from "./compiler.js";

export type ArtifactMode = "document" | "presentation" | "dashboard";
export type ArtifactTheme = { visualDirection: string; accent: string; appearance: "light" | "dark" };
export type ArtifactBlock = {
  id: string;
  type: string;
  title: string;
  brief: string;
  layout: string;
  contentScope: string[];
  acceptanceCriteria: string[];
};

export const ARTIFACT_GENERATION_TIMEOUT = {
  totalMs: 30 * 60_000,
  stepMs: 30 * 60_000,
  chunkMs: 5 * 60_000,
} as const;

// Same retryable class as the video pipeline's ArkRequestError: rate limits and
// upstream 5xx are transient, so we rethrow them to let the WDK step retry
// instead of degrading a block. 4xx (bad params / moderation) is terminal.
export function isRetryableProviderError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (error.isRetryable) return true;
    const status = error.statusCode;
    return status === 429 || (status != null && status >= 500);
  }
  return false;
}

export async function buildArtifactTextModel(providerId: string, orgId: string) {
  const provider: ChatProvider = await getProvider(providerId, orgId);
  const model = createProviderModel(provider, { disableReasoning: true });
  return { model, maxOutputTokens: provider.maxOutputTokens };
}

async function collectText(result: { textStream: AsyncIterable<string> }): Promise<string> {
  let raw = "";
  for await (const delta of result.textStream) raw += delta;
  return raw;
}

function blockInstructions(input: {
  block: ArtifactBlock;
  mode: ArtifactMode;
  theme: ArtifactTheme;
  outline: ArtifactBlock[];
  narrative: string;
  revision: boolean;
}): string {
  return [
    "Generate one semantic HTML body fragment for a larger compiled artifact.",
    "Return only the fragment: no markdown fence, doctype, html, head, or body tags.",
    "Inline JavaScript, canvas, controls, and event handlers are available for interactions. Keep scripts self-contained, place them after the markup they initialize, and scope DOM queries to the current artifact block. The compiler namespaces local ids and rewrites static '#id' selectors and getElementById('id') calls; prefer data-* selectors for dynamic code.",
    "The platform provides the responsive template, design tokens, and Grid/Flex primitives below. Compose them instead of rebuilding the page shell.",
    "You may use topic-specific classes, inline styles, media queries, and one <style> element only when the platform primitives cannot express the composition. Scope every selector under the current block id.",
    `Current block selector: #${input.block.id}. Do not target html, body, :root, or another block id.`,
    `The compiler owns id="${input.block.id}" on the outer block. Never declare that id, or any page-N id, inside the fragment. Give block-local targets descriptive unique ids; the compiler namespaces them and rewrites local references.`,
    "Do not use @import, CSS url(), external fonts, external stylesheets, external scripts, network requests, storage, popups, or top-level navigation. The preview sandbox intentionally blocks those capabilities.",
    "<visual_capabilities>",
    ARTIFACT_VISUAL_CAPABILITIES,
    "</visual_capabilities>",
    "<starter_template>",
    '<header class="artifact-stack"><p>Short eyebrow</p><h1>Specific page title</h1><p class="artifact-prose">Concise introduction.</p></header>',
    '<div class="artifact-grid"><section class="artifact-card artifact-stack"><h2>Section</h2><p>Content</p></section></div>',
    "For a two-column composition use artifact-split. For metrics use artifact-metric-grid. Wrap every table in artifact-table-scroll.",
    "</starter_template>",
    `Shared visual direction: ${input.theme.visualDirection}`,
    `Whole-artifact narrative: ${input.narrative}`,
    `Current block layout intent: ${input.block.layout}`,
    input.revision
      ? "The current change_request has highest priority. Treat the existing HTML as the source of truth for unaffected facts and content; stored narrative and layout intent are advisory when they conflict with the current HTML or requested change."
      : "Explicit requirements and facts in artifact_brief are authoritative. Use the narrative and layout intent to organize and fill gaps without contradicting the brief, and keep this block's assigned content distinct from every other block.",
    `Canvas appearance: ${input.theme.appearance}. Keep the block's dominant surfaces consistent with it.`,
    input.theme.appearance === "light"
      ? "For this light artifact, color words such as navy, deep blue, cyan, black, 深蓝, or 深色系 specify accent hue only and never imply dark mode. Do not introduce dark page-sized backgrounds, dark chart backgrounds, or make most cards dark. Use light surfaces and dark text; apply saturated or dark colors selectively to hierarchy and data marks."
      : "For this dark artifact, maintain accessible contrast for all text, tables, axes, legends, labels, and tooltips.",
    `Suggested accent: ${input.theme.accent}. Treat it as inspiration, not a required token.`,
    "Internal navigation must use fragment links such as href=\"#chapter-id\"; the compiler gives every block that id.",
    "<chart_spec>",
    ARTIFACT_CHART_SPEC,
    "</chart_spec>",
    "Use accessible headings, table headers, and image alt text.",
    `Mode is content intent only (${input.mode}); it does not prescribe colors, dimensions, density, or layout.`,
    `Whole outline ownership map: ${input.outline.map((block) => `${block.id}:${block.title} [${block.contentScope.join("; ")}]`).join(" | ")}`,
  ].join("\n");
}

export async function generateBlock(input: {
  block: ArtifactBlock;
  mode: ArtifactMode;
  theme: ArtifactTheme;
  outline: ArtifactBlock[];
  narrative: string;
  artifactBrief: string;
  tools: Awaited<ReturnType<typeof buildArtifactTextModel>>;
  abortSignal: AbortSignal;
  currentHtml?: string;
  changeBrief?: string;
}): Promise<string> {
  const prompt = input.currentHtml
      ? [
          `<artifact_brief>${input.artifactBrief}</artifact_brief>`,
          `<block id="${input.block.id}" title="${input.block.title}">${input.currentHtml}</block>`,
          `<change_request>${input.changeBrief ?? input.block.brief}</change_request>`,
          "Return the complete revised fragment for this block.",
        ].join("\n")
      : [
          `<artifact_brief>${input.artifactBrief}</artifact_brief>`,
          `<block id="${input.block.id}" title="${input.block.title}">${input.block.brief}</block>`,
        ].join("\n");
  const result = streamText({
    model: input.tools.model,
    maxOutputTokens: input.tools.maxOutputTokens,
    instructions: blockInstructions({ ...input, revision: Boolean(input.currentHtml) }),
    prompt,
    timeout: ARTIFACT_GENERATION_TIMEOUT,
    abortSignal: input.abortSignal,
  });
  const html = sanitizeArtifactPart(await collectText(result), input.block.id);
  if (!html) throw new Error(`block ${input.block.id} produced empty or unsafe HTML`);
  return html;
}
