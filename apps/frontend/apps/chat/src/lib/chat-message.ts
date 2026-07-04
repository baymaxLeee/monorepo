import type { UIMessage } from "ai";

export type ChatUIDataTypes = {
  "plan-execution": {
    document_id: string;
  };
  "conversation-title": {
    title: string;
  };
};

export type ChatUIMessage = UIMessage<unknown, ChatUIDataTypes>;
