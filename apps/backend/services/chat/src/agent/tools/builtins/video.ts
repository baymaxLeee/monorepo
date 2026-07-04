import { tool } from "ai";
import { z } from "zod";

import { mediaToolContextSchema, type MediaToolContext } from "../context.js";
import { startTaskResilient, TaskWaitTimeoutError, waitForTaskTerminal } from "../task-runner.js";
import type { Task } from "../../../clients/executor.js";

function videoResultDocumentId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const documentId = (result as { documentId?: unknown }).documentId;
  return typeof documentId === "string" ? documentId : undefined;
}

function safeVideoFilename(prompt: string): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "video";
  return `${slug}.mp4`;
}

const VIDEO_TARGET_MIN_S = 5;
const VIDEO_TARGET_MAX_S = 120;

export interface VideoToolProviders {
  videoProviderId: string;
  textProviderId: string;
  imageProviderId: string | null;
}

export function createVideoTools(providers: VideoToolProviders) {
  return {
    generate_video: tool({
      description:
        "Generate a VERTICAL (9:16) short-drama video for 抖音/小红书 投流 from a text premise, using the user's configured video model (Volcengine Ark Seedance 2.x), and render it inline in the chat. Use this whenever the user asks to create, make, or generate a video, drama, skit, or clip. Write the premise as a concrete story/scene idea (characters, conflict, setting, tone) — the tool internally writes a short-drama SCRIPT (distinct beats + a visual throughline), storyboards each beat into a native MULTI-SHOT segment, locks characters with a reference sheet, and stitches the segments into one vertical reel with native audio. CONTROLLING LENGTH: total length is set ONLY by the `duration` argument (whole seconds of the FINAL reel) — never just claim a length in your reply, your text does not affect the output. Range is 5–120s; omit for a ~50s default. Video generation is asynchronous and takes tens of seconds to a few minutes; this call runs it as a durable background task and blocks until it finishes, then returns the persisted video — do not restate file IDs or download steps, and do not call it again for the same request while it is running. Requires the user to have configured and selected a video provider; if none is available the tool returns an error you must relay, asking them to configure one in model management.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "A concrete short-drama PREMISE the internal storyboard planner will break into shots. Describe the STORY, not camera angles: the protagonist's key appearance (so they stay recognizable across independently generated shots), the core conflict/stakes, the setting/world, the emotional tone, and any pacing/twist ideas. Prose is fine — a richer premise yields a sharper shot list.",
          ),
        duration: z
          .number()
          .int()
          .min(VIDEO_TARGET_MIN_S)
          .max(VIDEO_TARGET_MAX_S)
          .optional()
          .describe(
            `Target total length of the finished reel in whole seconds (${VIDEO_TARGET_MIN_S}–${VIDEO_TARGET_MAX_S}). Omit for a ~50s default. This is the WHOLE reel; the tool splits it into multi-shot segments internally.`,
          ),
        continuity: z
          .enum(["cut", "chain"])
          .optional()
          .describe(
            "Segment-to-segment joining. 'cut' (default): fast hard cuts, segments render in parallel — the native language of 投流 short-drama. 'chain': seamless — each segment continues from the previous one's last frame (slower, serial). Only set 'chain' when the user explicitly asks for a seamless/continuous single-take feel.",
          ),
        todo_id: z
          .string()
          .max(64)
          .optional()
          .describe(
            "Optional id of the todo item this video fulfills. Set it when executing a plan/todo list so the UI flips that todo to done the moment this task finishes; omit for ad-hoc calls.",
          ),
      }),
      contextSchema: mediaToolContextSchema,
      execute: (input, options) => generateVideoTool(input, options, providers),
    }),
  };
}

type GenerateVideoInput = {
  prompt: string;
  duration?: number;
  continuity?: "cut" | "chain";
  todo_id?: string;
};

export async function* generateVideoTool(
  input: GenerateVideoInput,
  {
    context,
    toolCallId,
    abortSignal,
  }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  providers: VideoToolProviders,
): AsyncGenerator<Record<string, unknown>> {
  const title = input.prompt.slice(0, 80);
  const filename = safeVideoFilename(input.prompt);

  try {
    const task = await startTaskResilient(
      {
        type: "video-generation",
        ownerRef: toolCallId,
        payload: {
          userId: context.userId,
          conversationId: context.conversationId,
          providerId: providers.videoProviderId,
          textProviderId: providers.textProviderId,
          imageProviderId: providers.imageProviderId ?? undefined,
          prompt: input.prompt,
          targetDurationSec: input.duration,
          continuity: input.continuity,
          title,
          filename,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );

    const base = {
      kind: "video" as const,
      title,
      filename,
      prompt: input.prompt,
      duration: input.duration,
      task_id: task.id,
      todo_id: input.todo_id,
    };
    yield { ok: true, status: task.status, ...base };

    let terminal: Task;
    try {
      terminal = await waitForTaskTerminal(task.id, abortSignal);
    } catch (error) {
      if (error instanceof TaskWaitTimeoutError) {
        yield {
          ok: false,
          status: "failed",
          error: "视频生成超时:超过 30 分钟未完成,已取消任务。",
          ...base,
        };
        return;
      }
      throw error;
    }

    if (terminal.status === "completed") {
      const documentId = videoResultDocumentId(terminal.result);
      yield {
        ok: true,
        status: "completed",
        document_id: documentId,
        media_type: "video/mp4",
        ...base,
      };
      return;
    }

    yield {
      ok: false,
      status: terminal.status,
      error: terminal.error ?? (terminal.status === "cancelled" ? "已取消" : "视频生成失败"),
      ...base,
    };
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] generate_video failed", { toolCallId, error });
    yield {
      ok: false,
      status: "failed",
      kind: "video",
      error: `视频生成失败:${String(error).slice(0, 300)}`,
      todo_id: input.todo_id,
    };
  }
}
