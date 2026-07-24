import { streamText } from "ai";

import { createProviderModel, type ChatProvider } from "@backend/transport-ts/provider-model";

import { getProvider } from "../../infrastructure/clients/admin.js";

const FILE_GENERATION_TIMEOUT = {
  totalMs: 30 * 60_000,
  stepMs: 30 * 60_000,
  chunkMs: 5 * 60_000,
} as const;

export async function buildFileTextModel(providerId: string, orgId: string) {
  const provider: ChatProvider = await getProvider(providerId, orgId);
  const model = createProviderModel(provider, { disableReasoning: true });
  return { model, maxOutputTokens: provider.maxOutputTokens };
}

async function collectText(result: { textStream: AsyncIterable<string> }): Promise<string> {
  let raw = "";
  for await (const delta of result.textStream) raw += delta;
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
  return [
    `Materialize the exact complete UTF-8 contents of ${outputPath}.`,
    "Return only file contents without a markdown fence.",
    /\.html?$/i.test(outputPath)
      ? "HTML retains the complete browser runtime. Use scripts, modules, dynamic DOM, events, Canvas, SVG, WebGL, forms, media, workers, and external libraries whenever the task asks for them."
      : null,
  ].filter(Boolean).join("\n");
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
    prompt: [
      "<shared_context>",
      input.sharedContext,
      "</shared_context>",
      "<task>",
      input.instruction,
      "</task>",
    ].join("\n"),
    timeout: FILE_GENERATION_TIMEOUT,
    abortSignal: input.abortSignal,
  });
  const raw = await collectText(result);
  const content = stripFence(raw);
  if (!content) throw new Error(`task ${input.taskId} produced empty file content`);
  return content;
}
