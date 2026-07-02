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

export function createVideoTools(videoProviderId: string) {
  return {
    generate_video: tool({
      description:
        "Generate a short video from a text prompt using the user's configured video model (e.g. Volcengine Ark Seedance) and render it inline in the chat. Use this whenever the user asks to create, make, or generate a video, animation, or short clip. Write the prompt in concrete cinematic detail (subject, action, camera movement, style, lighting, mood). Video generation is asynchronous and takes tens of seconds to a few minutes; this call runs it as a durable background task and blocks until it finishes, then returns the persisted video — do not restate file IDs or download steps, and do not call it again for the same request while it is running. Requires the user to have configured and selected a video provider; if none is available the tool returns an error you must relay, asking them to configure one in model management.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe("Rich, concrete cinematic description of the video to generate."),
      }),
      contextSchema: mediaToolContextSchema,
      execute: (input, options) => generateVideoTool(input, options, videoProviderId),
    }),
  };
}

type GenerateVideoInput = { prompt: string };

export async function* generateVideoTool(
  input: GenerateVideoInput,
  {
    context,
    toolCallId,
    abortSignal,
  }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  videoProviderId: string,
): AsyncGenerator<Record<string, unknown>> {
  const title = input.prompt.slice(0, 80);
  const filename = safeVideoFilename(input.prompt);

  try {
    // Dispatch a durable executor task and foreground-block on it. The first
    // yield exposes task_id + status so the video card mounts and shows a
    // generating state; the final yield carries the persisted document_id.
    // Only the provider id (a reference) travels in the persisted payload; the
    // executor hydrates the decrypted key in-step at run time (ADR-0014).
    const task = await startTaskResilient(
      {
        type: "video-generation",
        ownerRef: toolCallId,
        payload: {
          userId: context.userId,
          conversationId: context.conversationId,
          providerId: videoProviderId,
          prompt: input.prompt,
          title,
          filename,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );

    const base = { kind: "video" as const, title, filename, prompt: input.prompt, task_id: task.id };
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
    };
  }
}
