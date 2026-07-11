import { APICallError, Output, extractJsonMiddleware, generateText, streamText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
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

const outlineSchema = z.object({
  visual_direction: z.string().min(1).max(1200).optional(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  appearance: z.enum(["light", "dark"]).optional(),
  pages: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        brief: z.string().min(1).max(MAX_BLOCK_BRIEF),
        content_scope: z.array(z.string().min(1).max(240)).min(1).max(12),
        acceptance_criteria: z.array(z.string().min(1).max(320)).min(1).max(12),
      }),
    )
    .min(1)
    .max(100),
});

export function resolvePageCount(input: { mode: ArtifactMode; brief: string; pageCount?: number }): number {
  const requested = Number(input.brief.match(/(?:^|\D)(\d{1,3})\s*(?:页|pages?)/i)?.[1]);
  return (
    input.pageCount ??
    (Number.isInteger(requested) && requested >= 1 && requested <= 100
      ? requested
      : input.mode === "presentation"
        ? 10
        : input.mode === "dashboard"
          ? 4
          : 8)
  );
}

function deterministicOutline(input: {
  title: string;
  mode: ArtifactMode;
  brief: string;
  count: number;
}): { theme: ArtifactTheme; blocks: ArtifactBlock[] } {
  return {
    theme: {
      visualDirection: "Choose a coherent visual direction that fits the subject and the user's requested tone. The model owns theme and layout.",
      accent: input.brief.match(/#[0-9a-f]{6}/i)?.[0] ?? "#2563eb",
      appearance: /(?:dark|深色|暗色|黑色)/i.test(input.brief) ? "dark" : "light",
    },
    blocks: Array.from({ length: input.count }, (_, index) => ({
      id: `page-${index + 1}`,
      type: input.mode === "presentation" ? "slide" : "section",
      title: `${input.title} · ${index + 1}/${input.count}`,
      brief: `Generate only ordered page/block ${index + 1} of ${input.count}. Derive its distinct content from the overall artifact brief and avoid repeating other pages.`,
      contentScope: [`Distinct content owned by page ${index + 1}`],
      acceptanceCriteria: [`Page ${index + 1} is complete, specific, and does not repeat another page.`],
    })),
  };
}

function outlineInstructions(input: { mode: ArtifactMode; count: number }): string {
  return [
    `Plan the outline for a ${input.count}-page ${input.mode} artifact.`,
    "Return exactly one entry per page in reading order.",
    "Each page needs a distinct, specific title and a brief that states what THIS page must cover so independently generated pages never overlap or leave gaps.",
    "The brief is an instruction to a writer, not prose: name the concrete sections, data points, or visuals that belong on this page and nothing that belongs on another page.",
    "For each page, return content_scope as the short list of topics/facts owned only by that page, and acceptance_criteria as concrete checks for completeness and presentation quality.",
    "Optionally pick one accent hex color that fits the topic.",
    "Choose light or dark appearance from the user's request and content context.",
    "Describe one specific visual direction shared by every page: color scheme, typography, composition, density, motifs, and chart treatment. Do not fall back to a generic template.",
    "Do not write any HTML; describe content only.",
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

export async function planArtifact(input: {
  title: string;
  mode: ArtifactMode;
  brief: string;
  pageCount?: number;
  model: Awaited<ReturnType<typeof buildArtifactTextModel>>["model"];
  abortSignal: AbortSignal;
}): Promise<{ theme: ArtifactTheme; blocks: ArtifactBlock[] }> {
  const count = resolvePageCount(input);
  const fallback = deterministicOutline({ title: input.title, mode: input.mode, brief: input.brief, count });
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: outlineSchema }),
      instructions: outlineInstructions({ mode: input.mode, count }),
      prompt: [
        `<title>${input.title}</title>`,
        `<page_count>${count}</page_count>`,
        `<artifact_brief>${input.brief}</artifact_brief>`,
      ].join("\n"),
      maxOutputTokens: 4_000,
      abortSignal: input.abortSignal,
    });
    const pages = result.output?.pages ?? [];
    if (!pages.length) return fallback;
    const accent = result.output?.accent?.match(/^#[0-9a-f]{6}$/i)?.[0] ?? fallback.theme.accent;
    return {
      theme: {
        visualDirection: result.output?.visual_direction?.trim() || fallback.theme.visualDirection,
        accent,
        appearance: result.output?.appearance ?? fallback.theme.appearance,
      },
      blocks: pages.map((page, index) => ({
        id: `page-${index + 1}`,
        type: input.mode === "presentation" ? "slide" : "section",
        title: page.title.slice(0, 160),
        brief: page.brief.slice(0, MAX_BLOCK_BRIEF),
        contentScope: page.content_scope,
        acceptanceCriteria: page.acceptance_criteria,
      })),
    };
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.error("[executor] artifact outline planning failed, using deterministic outline", error);
    return fallback;
  }
}

function blockInstructions(input: {
  block: ArtifactBlock;
  mode: ArtifactMode;
  theme: ArtifactTheme;
  outline: ArtifactBlock[];
}): string {
  return [
    "Generate one semantic HTML body fragment for a larger compiled artifact.",
    "Return only the fragment: no markdown fence, doctype, html, head, body, or script tags.",
    "Never emit inline JavaScript or event-handler attributes.",
    "The platform provides the responsive template, design tokens, and Grid/Flex primitives below. Compose them instead of rebuilding the page shell.",
    "You may use topic-specific classes, inline styles, media queries, and one <style> element only when the platform primitives cannot express the composition. Scope every selector under the current block id.",
    `Current block selector: #${input.block.id}. Do not target html, body, :root, or another block id.`,
    `The compiler owns id="${input.block.id}" on the outer block. Never declare that id, or any page-N id, inside the fragment. Give block-local targets descriptive unique ids; the compiler namespaces them and rewrites local references.`,
    "Do not use @import, CSS url(), external fonts, external stylesheets, or external images. The runtime removes them.",
    "<visual_capabilities>",
    ARTIFACT_VISUAL_CAPABILITIES,
    "</visual_capabilities>",
    "<starter_template>",
    '<header class="artifact-stack"><p>Short eyebrow</p><h1>Specific page title</h1><p class="artifact-prose">Concise introduction.</p></header>',
    '<div class="artifact-grid"><section class="artifact-card artifact-stack"><h2>Section</h2><p>Content</p></section></div>',
    "For a two-column composition use artifact-split. For metrics use artifact-metric-grid. Wrap every table in artifact-table-scroll.",
    "</starter_template>",
    `Shared visual direction: ${input.theme.visualDirection}`,
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
    instructions: blockInstructions(input),
    prompt,
    timeout: ARTIFACT_GENERATION_TIMEOUT,
    abortSignal: input.abortSignal,
  });
  const html = sanitizeArtifactPart(await collectText(result), input.block.id);
  if (!html) throw new Error(`block ${input.block.id} produced empty or unsafe HTML`);
  return html;
}

export { combinedSignal, themeSchema, blockSchema };
