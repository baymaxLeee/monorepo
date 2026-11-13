import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { utilityProcess, type UtilityProcess } from "electron";

import type { DesktopEvent } from "../contracts/bridge.generated";

export class RuntimeHost {
  private child: UtilityProcess;
  private dead = false;
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private requests = new Map<string, AbortController>();
  constructor(
    directory: string,
    private readonly fetchApi: (path: string, init?: RequestInit) => Promise<Response>,
    emit: (event: DesktopEvent) => void,
  ) {
    this.child = utilityProcess.fork(join(directory, "runtime-worker.cjs"), [], {
      serviceName: "Monorepo Local Agent",
      stdio: "ignore",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    });
    this.child.on("exit", () => {
      this.dead = true;
      for (const request of this.requests.values()) request.abort();
      this.requests.clear();
      for (const callback of this.pending.values())
        callback.reject(new Error("本地运行时退出；重新打开会话后可恢复历史"));
      this.pending.clear();
      emit({ type: "runtime-error", message: "本地运行时已退出，请重新启动桌面应用" });
    });
    this.child.on("message", (message: Record<string, unknown>) => {
      const id = String(message.id);
      if (message.type === "result") {
        const callback = this.pending.get(id);
        this.pending.delete(id);
        if (message.error) callback?.reject(new Error(String(message.error)));
        else callback?.resolve(message.result);
      } else if (message.type === "event") emit(message.event as DesktopEvent);
      else if (message.type === "request") {
        const abort = new AbortController();
        this.requests.set(id, abort);
        const agentId = (message.payload as { agentId: string | null }).agentId;
        void this.fetchApi(
          `/api/chat-server/local-inference/config${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
          { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) },
        )
          .then((response) => response.json())
          .then((result) => this.child.postMessage({ type: "response", id, result }))
          .catch((error: unknown) =>
            this.child.postMessage({
              type: "response",
              id,
              error: error instanceof Error ? error.message : "无法取得模型配置",
            }),
          )
          .finally(() => this.requests.delete(id));
      } else if (message.type === "inference") void this.inference(id, message.body);
      else if (message.type === "inference-cancel") this.requests.get(id)?.abort();
    });
  }
  call<T = unknown>(method: string, payload?: unknown): Promise<T> {
    if (this.dead) return Promise.reject(new Error("本地运行时已退出，请重启应用"));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("本地操作超时，请重启应用"));
        },
        method === "close" ? 10_000 : 180_000,
      );
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.postMessage({ type: "call", id, method, payload });
    });
  }
  private async inference(id: string, body: unknown) {
    const abort = new AbortController();
    this.requests.set(id, abort);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetchApi("/api/chat-server/local-inference/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.body) throw new Error("模型响应没有内容");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "",
        bytes = 0,
        finished = false;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 8 * 1024 * 1024) throw new Error("模型响应超过大小限制");
        buffer += decoder.decode(next.value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          const part: { type: string } = JSON.parse(line);
          if (part.type === "finish") finished = true;
          this.child.postMessage({ type: "inference-part", id, part });
        }
      }
      if (!finished || buffer.trim()) throw new Error("模型响应中断，请重新发起请求");
      this.child.postMessage({ type: "inference-end", id });
    } catch (error) {
      this.child.postMessage({
        type: "inference-error",
        id,
        error: error instanceof Error ? error.message : "模型请求失败",
      });
    } finally {
      abort.abort();
      await reader?.cancel().catch(() => undefined);
      this.requests.delete(id);
    }
  }
  async close() {
    for (const request of this.requests.values()) request.abort();
    try {
      await this.call("close");
    } finally {
      this.child.kill();
    }
  }
}
