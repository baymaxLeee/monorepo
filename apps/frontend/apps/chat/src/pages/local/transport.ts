import type { DesktopBridge, DesktopEvent, LocalThread } from "@repo/runtime/desktop";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

type StreamEvent = Extract<DesktopEvent, { type: "stream" }>;

// Subscribe before taking the native snapshot, then discard replayed indices.
// Disconnecting a renderer only detaches its subscription; Stop is explicit.
export async function attachLocalStream(bridge: DesktopBridge, id: string, includeFinished = false) {
  let pending: StreamEvent[] = [],
    receive: ((event: StreamEvent) => void) | null = null;
  let detach = () => {};
  let failure: string | null = null,
    fail: ((message: string) => void) | null = null;
  const unsubscribe = bridge.subscribe((event) => {
    if (event.type === "runtime-error") {
      failure = event.message;
      fail?.(event.message);
    }
    if (event.type === "stream" && event.threadId === id) {
      if (receive) receive(event);
      else pending.push(event);
    }
  });
  try {
    const snapshot = await bridge.openStream(id);
    const segment = snapshot.segment;
    if (!segment || (segment.done && !includeFinished)) {
      unsubscribe();
      return { thread: snapshot.thread, stream: null, dispose: unsubscribe };
    }
    let next = 0,
      ended = false;
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        const close = () => {
          if (!ended) {
            ended = true;
            unsubscribe();
            controller.close();
          }
        };
        detach = close;
        fail = (message) => {
          if (!ended) {
            ended = true;
            unsubscribe();
            controller.error(new Error(message));
          }
        };
        receive = (event) => {
          if (ended || event.segmentId !== segment.id || event.index < next) return;
          if (event.index !== next) {
            fail?.("本地消息流缺失，请重新打开会话");
            return;
          }
          if (event.chunk === null) close();
          else {
            next++;
            controller.enqueue(event.chunk);
          }
        };
        for (const chunk of segment.chunks) {
          controller.enqueue(chunk);
          next++;
        }
        for (const event of pending) receive(event);
        pending = [];
        if (failure) fail(failure);
        else if (segment.done) close();
      },
      cancel() {
        ended = true;
        unsubscribe();
      },
    });
    return {
      thread: { ...snapshot.thread, messages: segment.messages },
      stream,
      dispose: () => {
        unsubscribe();
        detach();
      },
    };
  } catch (error) {
    unsubscribe();
    throw error;
  }
}

export class LocalChatTransport implements ChatTransport<UIMessage> {
  private initial: Awaited<ReturnType<typeof attachLocalStream>> | null = null;
  constructor(
    private readonly bridge: DesktopBridge,
    private readonly id: string,
  ) {}
  async load(): Promise<LocalThread> {
    this.initial?.dispose();
    this.initial = await attachLocalStream(this.bridge, this.id);
    return this.initial.thread;
  }
  async sendMessages(options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
    if (options.trigger !== "submit-message") throw new Error("请发送新消息继续；不会重放已经执行的工具");
    const last = options.messages.at(-1);
    if (last?.role !== "user") throw new Error("需要用户消息");
    const text = last.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    await this.bridge.send(this.id, text, last.id);
    const connection = await attachLocalStream(this.bridge, this.id, true);
    const disconnect = () => connection.dispose();
    options.abortSignal?.addEventListener("abort", disconnect, { once: true });
    return (
      connection.stream ??
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close();
        },
      })
    );
  }
  async reconnectToStream() {
    if (this.initial) {
      const connection = this.initial;
      this.initial = null;
      return connection.stream;
    }
    return (await attachLocalStream(this.bridge, this.id)).stream;
  }
  dispose() {
    this.initial?.dispose();
    this.initial = null;
  }
}
