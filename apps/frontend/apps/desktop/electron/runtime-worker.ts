import { randomUUID } from "node:crypto";

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { z } from "zod";

import { inferenceConfigSchema } from "../contracts/inference.generated";
import { LocalSessionHost } from "./session-host";

const port = process.parentPort;
if (!port) throw new Error("Local runtime requires an Electron utility parent");
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const cleanups = new Map<string, () => void>();
const streams = new Map<string, ReadableStreamDefaultController<LanguageModelV4StreamPart>>();
let runtime: LocalSessionHost | null = null;
let closing = false;
const ownerPid = process.ppid;
// Keep command ownership tied to the desktop even if the browser process dies
// before Chromium delivers its normal utility-process shutdown message.
const ownerWatch = setInterval(() => {
  if (process.ppid === ownerPid && ownerPid > 1) return;
  clearInterval(ownerWatch);
  closing = true;
  void runtime?.close().finally(() => process.exit(1));
  if (!runtime) process.exit(1);
}, 1000);
ownerWatch.unref();

function request(method: string, payload: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  const id = randomUUID();
  const cancel = () => {
    pending.get(id)?.reject(new Error("请求已取消"));
    pending.delete(id);
    port.postMessage({ type: "inference-cancel", id });
  };
  const result = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    signal.addEventListener("abort", cancel, { once: true });
    port.postMessage({ type: "request", id, method, payload });
  });
  return result.finally(() => signal.removeEventListener("abort", cancel));
}
const idSchema = z.string().uuid();
const fileSchema = z.object({ id: idSchema, path: z.string().max(4096) });

async function dispatch(method: string, payload: unknown) {
  if (method === "open") {
    closing = true;
    if (runtime) await runtime.close();
    const settings = z
      .object({
        directory: z.string(),
        legacyDirectories: z.array(z.string()),
        controlDirectories: z.array(z.string()).min(1),
        supervisor: z.string(),
        executable: z.string(),
        fileWorker: z.string(),
      })
      .parse(payload);
    runtime = new LocalSessionHost({
      ...settings,
      config: async (agentId, signal) => inferenceConfigSchema.parse(await request("config", { agentId }, signal)),
      call: async (body, signal) => {
        signal?.throwIfAborted();
        const id = body.requestId;
        const cancel = () => {
          const controller = streams.get(id);
          streams.delete(id);
          cleanups.get(id)?.();
          cleanups.delete(id);
          controller?.error(new Error("推理已取消"));
          port.postMessage({ type: "inference-cancel", id });
        };
        signal?.addEventListener("abort", cancel, { once: true });
        cleanups.set(id, () => signal?.removeEventListener("abort", cancel));
        return new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            streams.set(id, controller);
            port.postMessage({ type: "inference", id, body });
          },
          cancel() {
            signal?.removeEventListener("abort", cancel);
            cleanups.delete(id);
            streams.delete(id);
            port.postMessage({ type: "inference-cancel", id });
          },
        });
      },
      emit: (event) => port.postMessage({ type: "event", event }),
    });
    closing = false;
    return null;
  }
  if (method === "close") {
    closing = true;
    await runtime?.close();
    runtime = null;
    return null;
  }
  if (!runtime || closing) throw new Error("请先登录并选择有效工作区");
  switch (method) {
    case "list":
      return runtime.list();
    case "create": {
      const p = z.object({ workspace: z.string(), agentId: z.string().nullable() }).parse(payload);
      return runtime.create(p.workspace, p.agentId);
    }
    case "openStream":
      return runtime.openStream(idSchema.parse(payload));
    case "get":
      return runtime.get(idSchema.parse(payload));
    case "send": {
      const p = z
        .object({ id: idSchema, messageId: idSchema, text: z.string().trim().min(1).max(64_000) })
        .parse(payload);
      runtime.send(p.id, p.text, p.messageId);
      return null;
    }
    case "steer": {
      const p = z
        .object({
          id: idSchema,
          expectedTurnId: idSchema,
          messageId: idSchema,
          text: z.string().trim().min(1).max(64_000),
          delivery: z.enum(["steer", "queue"]),
        })
        .parse(payload);
      return runtime.steer(p.id, p.expectedTurnId, p.text, p.messageId, p.delivery);
    }
    case "approve": {
      const p = z.object({ id: idSchema, approvalId: z.string().max(200), approved: z.boolean() }).parse(payload);
      runtime.approve(p.id, p.approvalId, p.approved);
      return null;
    }
    case "stop":
      await runtime.stop(idSchema.parse(payload));
      return null;
    case "remove":
      await runtime.remove(idSchema.parse(payload));
      return null;
    case "listFiles":
    case "readFile": {
      const p = fileSchema.parse(payload);
      return runtime.file(p.id, { operation: method === "listFiles" ? "list" : "read", path: p.path });
    }
    case "writeFile": {
      const p = fileSchema
        .extend({ content: z.string().max(2 * 1024 * 1024), expectedHash: z.string().nullable() })
        .parse(payload);
      return runtime.file(p.id, { operation: "write", path: p.path, content: p.content, expectedHash: p.expectedHash });
    }
    default:
      throw new Error("未知本地能力");
  }
}
port.on("message", ({ data }: { data: Record<string, unknown> }) => {
  if (data.type === "response") {
    const callback = pending.get(String(data.id));
    pending.delete(String(data.id));
    if (data.error) callback?.reject(new Error(String(data.error)));
    else callback?.resolve(data.result);
  } else if (data.type === "inference-part") {
    streams.get(String(data.id))?.enqueue(data.part as LanguageModelV4StreamPart);
  } else if (data.type === "inference-end" || data.type === "inference-error") {
    const controller = streams.get(String(data.id));
    streams.delete(String(data.id));
    cleanups.get(String(data.id))?.();
    cleanups.delete(String(data.id));
    if (data.type === "inference-error") controller?.error(new Error(String(data.error)));
    else controller?.close();
  } else if (data.type === "call") {
    void dispatch(String(data.method), data.payload)
      .then((result) => port.postMessage({ type: "result", id: data.id, result }))
      .catch((error: unknown) =>
        port.postMessage({
          type: "result",
          id: data.id,
          error: error instanceof Error ? error.message : "本地操作失败",
        }),
      );
  }
});
