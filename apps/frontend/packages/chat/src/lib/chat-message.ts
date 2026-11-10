import type { UIMessage } from "ai";

import type { ChatMessageMetadata, ChatUIDataTypes } from "./generated/chat-ui";
export { chatDataPartSchemas, chatMessageMetadataSchema } from "./generated/chat-ui";
export type { ChatMessageMetadata, ChatUIDataTypes } from "./generated/chat-ui";
export type ChatUIMessage = UIMessage<ChatMessageMetadata, ChatUIDataTypes>;
