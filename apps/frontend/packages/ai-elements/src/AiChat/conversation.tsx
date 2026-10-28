import { Button } from "@repo/design-system/shadcn/button";
import {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerButton,
  useMessageScroller,
} from "@repo/design-system/shadcn/message-scroller";
import { cn } from "@repo/shared";
import type { UIMessage } from "ai";
import { DownloadIcon } from "lucide-react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { useCallback, useImperativeHandle } from "react";

export type ConversationScrollHandle = ReturnType<typeof useMessageScroller>;

export type ConversationProps = ComponentProps<typeof MessageScroller> & {
  scrollRef?: Ref<ConversationScrollHandle>;
};

function ScrollHandle({ scrollRef }: Pick<ConversationProps, "scrollRef">) {
  const scroller = useMessageScroller();
  useImperativeHandle(scrollRef, () => scroller, [scroller]);
  return null;
}

export function Conversation({ className, scrollRef, children, ...props }: ConversationProps) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <ScrollHandle scrollRef={scrollRef} />
      <MessageScroller className={cn("min-h-0 flex-1", className)} {...props}>
        {children}
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export type ConversationContentProps = ComponentProps<typeof MessageScrollerContent> & { scrollClassName?: string };

export function ConversationContent({ className, scrollClassName, ...props }: ConversationContentProps) {
  return (
    <MessageScrollerViewport className={scrollClassName}>
      <MessageScrollerContent className={cn("gap-4 p-4", className)} {...props} />
    </MessageScrollerViewport>
  );
}

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export function ConversationEmptyState({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div
      className={cn("flex size-full flex-col items-center justify-center gap-3 p-8 text-center", className)}
      {...props}
    >
      {children ?? (
        <>
          {icon ? <div className="text-muted-foreground">{icon}</div> : null}
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{title}</h3>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

export type ConversationScrollButtonProps = ComponentProps<typeof MessageScrollerButton>;

export function ConversationScrollButton({ className, ...props }: ConversationScrollButtonProps) {
  return <MessageScrollerButton className={className} aria-label="回到底部" {...props} />;
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function defaultFormatMessage(message: UIMessage): string {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
}

export type ConversationDownloadProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

export function messagesToMarkdown(
  messages: UIMessage[],
  formatMessage: (message: UIMessage, index: number) => string = defaultFormatMessage,
): string {
  return messages.map((message, index) => formatMessage(message, index)).join("\n\n");
}

export function downloadConversationMarkdown(
  messages: UIMessage[],
  filename = "conversation.md",
  formatMessage: (message: UIMessage, index: number) => string = defaultFormatMessage,
) {
  const markdown = messagesToMarkdown(messages, formatMessage);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ConversationDownload({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) {
  const handleDownload = useCallback(() => {
    downloadConversationMarkdown(messages, filename, formatMessage);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn("absolute top-4 right-4 rounded-full", className)}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
}
