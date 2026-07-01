import type { UIMessage } from "ai";

export type ChatUIDataTypes = {
  "plan-execution": {
    document_id: string;
  };
  // Transient (not persisted) part carrying the auto-generated conversation
  // title, streamed on the first turn so the header + sidebar update live.
  "conversation-title": {
    title: string;
  };
};

export type ChatUIMessage = UIMessage<unknown, ChatUIDataTypes>;
