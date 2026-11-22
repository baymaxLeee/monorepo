import type { ChatUIDataTypes } from "./chat-message";

const NETWORK_REASON_LABEL: Record<ChatUIDataTypes["model-retry"]["reason"], string> = {
  dns: "模型服务域名解析失败",
  timeout: "模型连接超时",
  connection_reset: "模型连接被重置",
  incomplete_stream: "模型响应流提前中断",
  provider_unavailable: "模型服务暂时不可用",
};

export function modelRetryStatusText(event: ChatUIDataTypes["model-retry"]): string {
  const reason = NETWORK_REASON_LABEL[event.reason];
  return event.state === "retrying"
    ? `${reason}，正在重连（${event.attempt}/${event.maxAttempts}）…`
    : `${reason}，已重试 ${event.maxAttempts} 次`;
}

export function contextCompactionStatusText(event: ChatUIDataTypes["context-compaction"]): string {
  return event.phase === "history" ? "正在压缩较早的会话历史，完成后继续当前任务…" : "上下文接近上限，正在压缩后继续…";
}
