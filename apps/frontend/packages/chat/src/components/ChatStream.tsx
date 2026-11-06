import { type Chat, useChat } from "@ai-sdk/react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  type ConversationScrollHandle,
} from "@repo/ai-elements";
import { type ComponentProps, type Ref, memo, useDeferredValue, useEffect, useMemo, useRef } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatTranscript } from "./ChatTranscript";

type ChatStreamProps = Omit<ComponentProps<typeof ChatTranscript>, "messages" | "status"> & {
  chat: Chat<ChatUIMessage>;
  scrollRef: Ref<ConversationScrollHandle>;
  onStatusChange: (status: Chat<ChatUIMessage>["status"]) => void;
  onCanvasChange?: () => void;
};

// The only live SDK subscriber in the conversation UI. Deltas never enter the
// shell, history, inspector, or composer. Only status transitions leave here.
export const ChatStream = memo(function ChatStream({
  chat,
  scrollRef,
  onStatusChange,
  onCanvasChange,
  ...props
}: ChatStreamProps) {
  const { messages, status } = useChat({ chat, resume: false, throttle: 50 });
  const snapshot = useDeferredValue(useMemo(() => ({ messages, status }), [messages, status]));
  const canvasCallback = useRef(onCanvasChange);
  useEffect(() => {
    canvasCallback.current = onCanvasChange;
  }, [onCanvasChange]);
  const canvasCompletions = messages.reduce(
    (count, message) =>
      count +
      message.parts.filter(
        (part) =>
          (part.type === "tool-create_canvas_storyboard_drafts" ||
            part.type === "tool-generate_canvas_nodes" ||
            part.type === "tool-update_canvas_node") &&
          "state" in part &&
          part.state === "output-available",
      ).length,
    0,
  );
  useEffect(() => {
    if (canvasCompletions) canvasCallback.current?.();
  }, [canvasCompletions]);
  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);
  return (
    <Conversation className="min-h-0 flex-1 basis-0" scrollRef={scrollRef}>
      <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-4 py-6">
        <ChatTranscript {...props} messages={snapshot.messages} status={snapshot.status} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
});
