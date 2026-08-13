import type { UIMessage } from "ai";

export type ChatMessageMetadata = {
  runId: string;
  providerId: string;
  model: string;
  responseId: string | null;
  parentResponseId: string | null;
  status: "streaming" | "completed" | "failed" | "cancelled";
  finishReason?: string;
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
  };
};

export type ChatUIDataTypes = {
  "plan-execution": {
    path: string;
  };
  "conversation-title": {
    title: string;
  };
  "skill-activation": {
    name: string;
  };
};

export type ChatUIMessage = UIMessage<ChatMessageMetadata, ChatUIDataTypes>;
