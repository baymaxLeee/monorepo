import { APICallError, Output, extractJsonMiddleware, generateText, streamText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { getProvider } from "../../infrastructure/clients/admin.js";
import {
  createProviderModel,
  JSON_OBJECT_MODE_INSTRUCTION,
  type ChatProvider,
} from "@backend/transport-ts/provider-model";
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

const themeSchema = z.object({
  visualDirection: z.string().min(1).max(1200),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  appearance: z.enum(["light", "dark"]),
});

const blockSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(80),
  type: z.string().min(1).max(40),
  title: z.string().min(1).max(160),
  brief: z.string().min(1).max(4000),
  layout: z.string().min(1).max(400),
  contentScope: z.array(z.string().min(1).max(240)).min(1).max(12),
  acceptanceCriteria: z.array(z.string().min(1).max(320)).min(1).max(12),
});

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

function combinedSignal(abortSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ARTIFACT_GENERATION_TIMEOUT.totalMs);
  return abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
}

const MAX_BLOCK_BRIEF = 4000;
const FALLBACK_NARRATIVE =
  "Build a coherent progression from context through the main evidence and implications to a clear conclusion.";
const FALLBACK_LAYOUT = "Use a clear, balanced composition that fits this block's content and reading order.";

const outlinePageSchema = z.object({
  title: z.string().min(1).max(160),
  brief: z.string().min(1).max(MAX_BLOCK_BRIEF),
  layout: z.string().min(1).max(400),
  content_scope: z.array(z.string().min(1).max(240)).min(1).max(12),
  acceptance_criteria: z.array(z.string().min(1).max(320)).min(1).max(12),
});

const outlineSchema = z.object({
  visual_direction: z.string().min(1).max(1200).optional(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  appearance: z.enum(["light", "dark"]),
  narrative: z.string().min(1).max(1500),
  pages: z.array(outlinePageSchema).min(1).max(100),
});

type ArtifactOutline = z.infer<typeof outlineSchema>;

export function fallbackPageCount(mode: ArtifactMode): number {
  return mode === "presentation" ? 10 : mode === "dashboard" ? 4 : 8;
}

function deterministicOutline(input: {
  title: string;
  mode: ArtifactMode;
  brief: string;
  count: number;
}): { theme: ArtifactTheme; narrative: string; blocks: ArtifactBlock[] } {
  return {
    theme: {
      visualDirection: "Choose a coherent visual direction and layout that fit the subject, requested tone, and resolved canvas appearance.",
      accent: input.brief.match(/#[0-9a-f]{6}/i)?.[0] ?? "#2563eb",
      appearance: "light",
    },
    narrative: FALLBACK_NARRATIVE,
    blocks: Array.from({ length: input.count }, (_, index) => ({
      id: `page-${index + 1}`,
      type: input.mode === "presentation" ? "slide" : "section",
      title: `${input.title} · ${index + 1}/${input.count}`,
      brief: `Generate only ordered page/block ${index + 1} of ${input.count}. Derive its distinct content from the overall artifact brief and avoid repeating other pages.`,
      layout: FALLBACK_LAYOUT,
      contentScope: [`Distinct content owned by page ${index + 1}`],
      acceptanceCriteria: [`Page ${index + 1} is complete, specific, and does not repeat another page.`],
    })),
  };
}

function outlineInstructions(input: {
  mode: ArtifactMode;
  requestedPageCount?: number;
}): string {
  return [
    input.requestedPageCount
      ? `Plan exactly ${input.requestedPageCount} pages for this ${input.mode} artifact.`
      : `Choose between 1 and 100 pages for this ${input.mode} artifact based on the content's scope and complexity.`,
    "Return exactly one entry per page in reading order.",
    "If the artifact brief contains an explicit ordered section or module list, preserve every module's order, facts, and scope without omission.",
    input.requestedPageCount
      ? "When an explicit module count differs from the required page count, keep module order and coverage while merging only adjacent modules or splitting dense modules to reach the exact page count."
      : "When an explicit module list is present, map one module to one page. Only design the page breakdown yourself when the brief has no explicit structure.",
    "Each page needs a distinct, specific title and a brief that states what THIS page must cover so independently generated pages never overlap or leave gaps.",
    "The brief is an instruction to a writer, not prose: name the concrete sections, data points, or visuals that belong on this page and nothing that belongs on another page.",
    "For each page, return one concrete layout intent, content_scope as the short list of topics/facts owned only by that page, and acceptance_criteria as concrete checks for completeness and presentation quality.",
    "Return one narrative through-line for the whole artifact so every page advances the same story without repetition.",
    "Optionally pick one accent hex color that fits the topic.",
    "Return one appearance for the entire artifact: light or dark. Resolve it semantically from the complete brief, including negation and contrast between canvas and accent colors.",
    "An explicit light or dark request is authoritative. A request that rejects, forbids, or negates dark appearance must return light. If the brief does not clearly request a dark canvas, return light.",
    "Technology, futuristic, cinematic, navy, deep blue, cyan, black, or saturated styling describes visual character or accent hue only; it does not imply a dark canvas.",
    "Make the shared visual direction and every page brief comply with the chosen appearance. For light appearance, use predominantly light canvas and surfaces with dark readable text; never prescribe a dark page, dominant panel, or chart background.",
    "Describe one specific visual direction shared by every page: color scheme, typography, composition, density, motifs, and chart treatment. Do not fall back to a generic template.",
    "Do not write any HTML; describe content only.",
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

function repairInstructions(input: { mode: ArtifactMode; count: number }): string {
  return [
    `Repair an existing ${input.mode} outline so it contains exactly ${input.count} pages.`,
    "Preserve the narrative, every module and fact, the original order, content ownership, and visual direction.",
    "Only repartition pages: merge adjacent pages or split dense pages. Do not omit content or invent empty filler pages.",
    "Preserve the existing appearance exactly in the shared visual direction and every page brief.",
    "Return the complete repaired outline, not a patch or explanation.",
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

async function generateOutline(input: {
  model: Awaited<ReturnType<typeof buildArtifactTextModel>>["model"];
  instructions: string;
  prompt: string;
  maxOutputTokens: number;
  abortSignal: AbortSignal;
}): Promise<ArtifactOutline> {
  const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
  const result = await generateText({
    model: structuredModel,
    output: Output.object({ schema: outlineSchema }),
    instructions: input.instructions,
    prompt: input.prompt,
    maxOutputTokens: input.maxOutputTokens,
    abortSignal: input.abortSignal,
  });
  return result.output;
}

function materializeOutline(input: {
  outline: ArtifactOutline;
  mode: ArtifactMode;
  fallback: ReturnType<typeof deterministicOutline>;
}): { theme: ArtifactTheme; narrative: string; blocks: ArtifactBlock[] } {
  const accent = input.outline.accent?.match(/^#[0-9a-f]{6}$/i)?.[0] ?? input.fallback.theme.accent;
  return {
    theme: {
      visualDirection: input.outline.visual_direction?.trim() || input.fallback.theme.visualDirection,
      accent,
      appearance: input.outline.appearance,
    },
    narrative: input.outline.narrative.trim(),
    blocks: input.outline.pages.map((page, index) => ({
      id: `page-${index + 1}`,
      type: input.mode === "presentation" ? "slide" : "section",
      title: page.title.slice(0, 160),
      brief: page.brief.slice(0, MAX_BLOCK_BRIEF),
      layout: page.layout.trim(),
      contentScope: page.content_scope,
      acceptanceCriteria: page.acceptance_criteria,
    })),
  };
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

export { combinedSignal, themeSchema, blockSchema };
