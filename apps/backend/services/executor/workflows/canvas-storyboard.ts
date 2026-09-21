import { AdminInternalClient } from "@backend/transport-ts";
import { createProviderModel } from "@backend/transport-ts/provider-model";
import { assertPublicProviderUrl } from "@backend/transport-ts/provider-url";
import { generateText, Output } from "ai";
import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { storyboardDetailPrompt, storyboardPlanPrompt } from "../src/application/canvas/storyboard-prompts.js";
import { claimTaskStep } from "../src/application/tasks/binding.js";
import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { getSettings } from "../src/bootstrap/config.js";

export const canvasStoryboardInputSchema = z
  .object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    providerId: z.string().min(1),
    plot: z.string().min(1).max(50000),
    durationMin: z.number().int().min(1),
    durationMax: z.number().int().max(300),
    totalDurationMin: z.number().int().min(0),
    totalDurationMax: z.number().int().min(0),
  })
  .refine((v) => v.durationMax >= v.durationMin && v.totalDurationMax >= v.totalDurationMin);
type Input = z.infer<typeof canvasStoryboardInputSchema>;
interface PlanItem {
  canvasnode_no: number;
  source_end_anchor: string;
  summary: string;
  target_duration_seconds: number;
  scene: string;
  continuity_group: string;
  characters: string[];
  props: string[];
  position_reference: string;
  asset_requirements: string[];
  source: string;
}
interface Draft {
  id: string;
  prompt: string;
  duration_seconds: number;
}
async function providerModel(input: Input) {
  const settings = getSettings();
  const client = new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
  });
  const p = await client.getProvider(input.providerId, input.tenantId, input.workspaceId);
  if (p.provider_kind !== "chat") throw new Error("Storyboard requires an inference provider");
  await assertPublicProviderUrl(p.base_url);
  return {
    model: createProviderModel({
      id: p.id,
      name: p.name,
      contextWindow: p.context_window,
      maxOutputTokens: p.max_output_tokens,
      model: p.model,
      baseUrl: p.base_url,
      apiKey: p.api_key,
      extraBody: p.extra_body ?? {},
    }),
    maxOutputTokens: p.max_output_tokens,
  };
}
async function planStep(input: Input): Promise<PlanItem[]> {
  "use step";
  const provider = await providerModel(input);
  const cancellation = observeTaskCancellation(getWorkflowMetadata().workflowRunId);
  try {
    const item = z.object({
      canvasnode_no: z.number().int().min(1),
      source_end_anchor: z.string().min(1),
      summary: z.string().min(1),
      target_duration_seconds: z.number().int().min(input.durationMin).max(input.durationMax),
      scene: z.string(),
      continuity_group: z.string(),
      characters: z.array(z.string()),
      props: z.array(z.string()),
      position_reference: z.string(),
      asset_requirements: z.array(z.string()),
    });
    const result = await generateText({
      ...provider,
      maxRetries: 0,
      abortSignal: cancellation.signal,
      system: storyboardPlanPrompt,
      prompt: `完整原始剧情：\n${input.plot}\n视频时长范围：${input.durationMin}-${input.durationMax}秒\n总时长参考：${input.totalDurationMin}-${input.totalDurationMax}秒`,
      output: Output.object({ schema: z.object({ canvas_nodes: z.array(item).min(1) }) }),
    });
    cancellation.signal.throwIfAborted();
    let offset = 0;
    const plan = result.output.canvas_nodes.map((entry, index) => {
      if (entry.canvasnode_no !== index + 1) throw new Error("Storyboard numbers are not contiguous");
      const rest = input.plot.slice(offset);
      const anchor = entry.source_end_anchor.trim();
      const at = rest.indexOf(anchor);
      if (at < 0 || rest.indexOf(anchor, at + 1) >= 0)
        throw new Error("Storyboard source anchor is missing or ambiguous");
      const end = offset + at + anchor.length;
      const source = input.plot.slice(offset, end);
      offset = end;
      return { ...entry, source };
    });
    if (input.plot.slice(offset).trim()) throw new Error("Storyboard omitted the end of the plot");
    return plan;
  } finally {
    cancellation.dispose();
  }
}
planStep.maxRetries = 0;
function draftPrompt(item: PlanItem, summary: string, text: string) {
  return `【剧情概述】\n${summary}\n\n【全局设定】\n场景：${item.scene}\n人物：${item.characters.join("、")}\n道具：${item.props.join("、")}\n\n【位置参考】\n${item.position_reference}\n\n【镜头脚本】\n${text}\n\n【声音设计】\n保留原文对白、同期声、环境声与动作音效，不添加背景音乐。`;
}
async function detailStep(input: Input, batch: PlanItem[], adjacent: PlanItem[]): Promise<Draft[]> {
  "use step";
  const provider = await providerModel(input);
  const cancellation = observeTaskCancellation(getWorkflowMetadata().workflowRunId);
  const accepted = new Map<number, Draft>();
  let feedback = "";
  try {
    for (let round = 0; round < 3 && accepted.size < batch.length; round++) {
      cancellation.signal.throwIfAborted();
      const missing = batch.filter((item) => !accepted.has(item.canvasnode_no));
      try {
        const result = await generateText({
          ...provider,
          maxRetries: 0,
          abortSignal: cancellation.signal,
          system: storyboardDetailPrompt,
          prompt: JSON.stringify({
            frozen_batch_plan: missing,
            adjacent_continuity_context: adjacent.map(({ source: _source, ...item }) => item),
            duration_min: input.durationMin,
            duration_max: input.durationMax,
            feedback,
          }),
          output: Output.object({
            schema: z.object({
              canvas_nodes: z
                .array(
                  z.object({
                    canvasnode_no: z.number().int(),
                    summary: z.string().min(1),
                    shots: z
                      .array(z.object({ duration_seconds: z.number().int().positive(), script: z.string().min(1) }))
                      .min(1),
                  }),
                )
                .min(1),
            }),
          }),
        });
        cancellation.signal.throwIfAborted();
        for (const detail of result.output.canvas_nodes) {
          const frozen = missing.find((item) => item.canvasnode_no === detail.canvasnode_no);
          if (!frozen) throw new Error("Detail changed frozen numbering");
          const duration = detail.shots.reduce((sum, shot) => sum + shot.duration_seconds, 0);
          if (duration < input.durationMin || duration > input.durationMax)
            throw new Error("Shot duration exceeds video capability");
          const text = detail.shots.map((shot) => shot.script).join("\n");
          const quoted = [...frozen.source.matchAll(/[“「『]([^”」』]+)[”」』]/gu)].map((match) => match[1]!);
          if (quoted.some((quote) => !text.includes(quote)))
            throw new Error("Detail omitted original dialogue or screen text");
          accepted.set(frozen.canvasnode_no, {
            id: String(frozen.canvasnode_no),
            prompt: draftPrompt(
              frozen,
              detail.summary,
              detail.shots.map((shot, index) => `${index + 1}. ${shot.duration_seconds}秒：${shot.script}`).join("\n"),
            ),
            duration_seconds: duration,
          });
        }
      } catch (error) {
        cancellation.signal.throwIfAborted();
        feedback = error instanceof Error ? error.message : "Invalid storyboard detail";
      }
    }
    return batch.map(
      (item) =>
        accepted.get(item.canvasnode_no) ?? {
          id: String(item.canvasnode_no),
          duration_seconds: item.target_duration_seconds,
          prompt: draftPrompt(item, item.summary, item.source),
        },
    );
  } finally {
    cancellation.dispose();
  }
}
detailStep.maxRetries = 0;
export async function canvasStoryboardWorkflow(input: Input, executorTaskId: string) {
  "use workflow";
  await claimTaskStep(executorTaskId);
  const plan = await planStep(input);
  const drafts = await detailStep(input, plan.slice(0, 1), plan.slice(1, 2));
  for (let index = 1; index < plan.length; index += 24) {
    const batches: Promise<Draft[]>[] = [];
    for (let start = index; start < Math.min(index + 24, plan.length); start += 3)
      batches.push(
        detailStep(input, plan.slice(start, start + 3), [plan[start - 1]!, ...plan.slice(start + 3, start + 4)]),
      );
    for (const batch of await Promise.all(batches)) drafts.push(...batch);
  }
  return { text: JSON.stringify(drafts) };
}
