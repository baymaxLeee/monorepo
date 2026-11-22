import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ fork: vi.fn() }));

vi.mock("electron", () => ({ utilityProcess: { fork: electron.fork } }));

import { RuntimeHost } from "../electron/host-runtime";

class FakeUtilityProcess extends EventEmitter {
  readonly messages: Record<string, unknown>[] = [];
  readonly kill = vi.fn();

  postMessage(message: Record<string, unknown>) {
    this.messages.push(message);
  }

  reply(index: number, result: unknown = null) {
    const request = this.messages[index];
    this.emit("message", { type: "result", id: request.id, result });
  }
}

beforeEach(() => electron.fork.mockReset());

it("restarts an exited worker and reopens the persisted local runtime", async () => {
  const first = new FakeUtilityProcess();
  const second = new FakeUtilityProcess();
  electron.fork.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const events: { type: string; message?: string }[] = [];
  const host = new RuntimeHost("/app", vi.fn(), (event) => events.push(event));
  const settings = { directory: "/sessions" };

  const opened = host.call("open", settings);
  await vi.waitFor(() => expect(first.messages).toHaveLength(1));
  first.reply(0);
  await opened;

  first.emit("exit", 1);
  await vi.waitFor(() => expect(second.messages).toHaveLength(1));
  expect(second.messages[0]).toMatchObject({ type: "call", method: "open", payload: settings });
  second.reply(0);
  await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: "runtime-ready" }));

  const listed = host.call("list");
  await vi.waitFor(() => expect(second.messages).toHaveLength(2));
  second.reply(1, ["restored"]);
  await expect(listed).resolves.toEqual(["restored"]);
  expect(events[0]).toMatchObject({ type: "runtime-error" });

  const closed = host.close();
  await vi.waitFor(() => expect(second.messages).toHaveLength(3));
  second.reply(2);
  await closed;
  expect(second.kill).toHaveBeenCalledOnce();
});

it("fails closed instead of looping when the replacement worker also exits", async () => {
  const first = new FakeUtilityProcess();
  const second = new FakeUtilityProcess();
  electron.fork.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const events: { type: string; message?: string }[] = [];
  const host = new RuntimeHost("/app", vi.fn(), (event) => events.push(event));

  const opened = host.call("open", { directory: "/sessions" });
  await vi.waitFor(() => expect(first.messages).toHaveLength(1));
  first.reply(0);
  await opened;
  first.emit("exit", 1);
  await vi.waitFor(() => expect(second.messages).toHaveLength(1));
  second.emit("exit", 1);

  await vi.waitFor(() => expect(events.at(-1)?.message).toContain("恢复失败"));
  await expect(host.call("list")).rejects.toThrow(/恢复失败|运行时退出/);
  expect(electron.fork).toHaveBeenCalledTimes(2);
  await host.close();
});

it("accepts a native model error part as a clean terminal event", async () => {
  const child = new FakeUtilityProcess();
  electron.fork.mockReturnValue(child);
  const error = {
    type: "error",
    error: {
      code: "model_connection_failed",
      message: "模型服务域名解析失败",
      retryable: true,
      reason: "dns",
    },
  };
  new RuntimeHost("/app", vi.fn().mockResolvedValue(new Response(`${JSON.stringify(error)}\n`)), vi.fn());

  child.emit("message", { type: "inference", id: "inference-1", body: {} });

  await vi.waitFor(() => expect(child.messages).toHaveLength(2));
  expect(child.messages).toEqual([
    { type: "inference-part", id: "inference-1", part: error },
    { type: "inference-end", id: "inference-1" },
  ]);
});

it("converts a truncated HTTP model body into a safe native error part", async () => {
  const child = new FakeUtilityProcess();
  electron.fork.mockReturnValue(child);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("net::ERR_INCOMPLETE_CHUNKED_ENCODING"));
    },
  });
  new RuntimeHost("/app", vi.fn().mockResolvedValue(new Response(body)), vi.fn());

  child.emit("message", { type: "inference", id: "inference-2", body: {} });

  await vi.waitFor(() => expect(child.messages).toHaveLength(2));
  expect(child.messages).toEqual([
    {
      type: "inference-part",
      id: "inference-2",
      part: {
        type: "error",
        error: {
          code: "model_connection_failed",
          message: "模型响应流提前中断",
          retryable: true,
          reason: "incomplete_stream",
        },
      },
    },
    { type: "inference-end", id: "inference-2" },
  ]);
});
