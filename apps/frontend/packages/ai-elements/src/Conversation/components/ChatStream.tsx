import { type Chat, useChat } from "@ai-sdk/react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  type ConversationScrollHandle,
} from "@repo/ai-elements";
import { isToolUIPart } from "ai";
import { type ComponentProps, type Ref, memo, useDeferredValue, useEffect, useMemo, useRef } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { toolUiKind } from "../lib/conversation-messages";
import { createSnapshotTailProjection } from "./chat-render-cache";
import { projectMessageActiveTodoList, type ActiveTodoList } from "./ChatPlanState";
import { ChatTranscript } from "./ChatTranscript";

type ChatStreamProps = Omit<ComponentProps<typeof ChatTranscript>, "messages" | "status"> & {
  chat: Chat<ChatUIMessage>;
  resume?: boolean;
  scrollRef: Ref<ConversationScrollHandle>;
  onStatusChange: (status: Chat<ChatUIMessage>["status"]) => void;
  onCanvasChange?: () => void;
  onPageToolWaiting?: (waiting: boolean) => void;
  onActivePlanChange?: (plan: ActiveTodoList | null) => void;
  onPendingInputsDelivered?: (ids: ReadonlySet<string>) => void;
};

type ChatStreamContentProps = Omit<ChatStreamProps, "scrollRef">;

const canvasCompletionCountByMessage = new WeakMap<ChatUIMessage, number>();
const steeringIdsByMessage = new WeakMap<ChatUIMessage, readonly string[]>();

function steeringIds(message: ChatUIMessage) {
  let ids = steeringIdsByMessage.get(message);
  if (!ids) {
    ids = message.parts.flatMap((part) => (part.type === "steering-message" ? [part.id] : []));
    steeringIdsByMessage.set(message, ids);
  }
  return ids;
}

function addSteeringIds(previous: ReadonlySet<string>, message: ChatUIMessage): ReadonlySet<string> {
  const ids = steeringIds(message);
  if (ids.length === 0 || ids.every((id) => previous.has(id))) return previous;
  const next = new Set(previous);
  ids.forEach((id) => next.add(id));
  return next;
}

function sameIds(previous: ReadonlySet<string>, next: ReadonlySet<string>) {
  return previous.size === next.size && [...previous].every((id) => next.has(id));
}

function countMessageCanvasCompletions(message: ChatUIMessage) {
  let count = canvasCompletionCountByMessage.get(message);
  if (count === undefined) {
    count = message.parts.filter(
      (part) =>
        (part.type === "tool-create_canvas_storyboard_drafts" ||
          part.type === "tool-generate_canvas_nodes" ||
          part.type === "tool-update_canvas_node") &&
        "state" in part &&
        part.state === "output-available",
    ).length;
    canvasCompletionCountByMessage.set(message, count);
  }
  return count;
}

function extendActivePlan(previous: ActiveTodoList | null, message: ChatUIMessage) {
  const messagePlan = projectMessageActiveTodoList(message);
  return messagePlan === undefined ? previous : messagePlan;
}

// The only live SDK subscriber in the conversation UI. Keeping it below the
// scroller shell means text deltas cannot re-render its provider or viewport.
export const ChatStreamContent = memo(function ChatStreamContent({
  chat,
  resume = false,
  onStatusChange,
  onCanvasChange,
  onPageToolWaiting,
  onActivePlanChange,
  onPendingInputsDelivered,
  ...props
}: ChatStreamContentProps) {
  const { messages, status } = useChat({ chat, resume, throttle: 50 });
  // Keep the transport/status subscriber current while React schedules the
  // high-frequency transcript as one consistent, interruptible snapshot. This
  // prevents a suspending message renderer from replacing the whole session UI.
  const transcript = useDeferredValue(useMemo(() => ({ messages, status }), [messages, status]));
  const projectActivePlan = useMemo(
    () => createSnapshotTailProjection<ChatUIMessage, ActiveTodoList | null>(null, extendActivePlan),
    [],
  );
  const activePlan = projectActivePlan(transcript.messages);
  const projectCanvasCompletions = useMemo(
    () =>
      createSnapshotTailProjection<ChatUIMessage, number>(
        0,
        (count, message) => count + countMessageCanvasCompletions(message),
      ),
    [],
  );
  const canvasCompletions = projectCanvasCompletions(messages);
  const projectDeliveredSteeringIds = useMemo(
    () => createSnapshotTailProjection<ChatUIMessage, ReadonlySet<string>>(new Set(), addSteeringIds, sameIds),
    [],
  );
  const deliveredSteeringIds = projectDeliveredSteeringIds(messages);
  const last = messages.at(-1);
  const waiting =
    !!onPageToolWaiting &&
    last?.role === "assistant" &&
    last.parts.some(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        !part.providerExecuted &&
        toolUiKind(part) === "agent-ui",
    );
  useEffect(() => {
    onPageToolWaiting?.(waiting);
  }, [onPageToolWaiting, waiting]);
  const canvasCallback = useRef(onCanvasChange);
  const pendingInputsDeliveredCallback = useRef(onPendingInputsDelivered);
  useEffect(() => {
    canvasCallback.current = onCanvasChange;
  }, [onCanvasChange]);
  useEffect(() => {
    pendingInputsDeliveredCallback.current = onPendingInputsDelivered;
  }, [onPendingInputsDelivered]);
  useEffect(() => {
    if (canvasCompletions) canvasCallback.current?.();
  }, [canvasCompletions]);
  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);
  useEffect(() => {
    onActivePlanChange?.(activePlan);
  }, [activePlan?.revision, onActivePlanChange]);
  useEffect(() => {
    if (deliveredSteeringIds.size > 0) pendingInputsDeliveredCallback.current?.(deliveredSteeringIds);
  }, [deliveredSteeringIds]);
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
