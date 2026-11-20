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
  resume?: boolean;
  scrollRef: Ref<ConversationScrollHandle>;
  onStatusChange: (status: Chat<ChatUIMessage>["status"]) => void;
  onCanvasChange?: () => void;
};

type ChatStreamContentProps = Omit<ChatStreamProps, "scrollRef">;

// The only live SDK subscriber in the conversation UI. Keeping it below the
// scroller shell means text deltas cannot re-render its provider or viewport.
const ChatStreamContent = memo(function ChatStreamContent({
  chat,
  resume = false,
  onStatusChange,
  onCanvasChange,
  ...props
}: ChatStreamContentProps) {
  const { messages, status } = useChat({ chat, resume, throttle: 50 });
  // Keep the transport/status subscriber current while React schedules the
  // high-frequency transcript as one consistent, interruptible snapshot.
  const transcript = useDeferredValue(useMemo(() => ({ messages, status }), [messages, status]));
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
  return <ChatTranscript {...props} messages={transcript.messages} status={transcript.status} />;
});

export const ChatStream = memo(function ChatStream({ scrollRef, ...content }: ChatStreamProps) {
  return (
    <Conversation className="min-h-0 flex-1 basis-0" scrollRef={scrollRef}>
      <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-4 py-6">
        <ChatStreamContent {...content} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
});
