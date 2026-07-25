import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import { cn } from "shared";
import { StickToBottom, type StickToBottomContext, useStickToBottomContext } from "use-stick-to-bottom";

import { Button } from "../shadcn/button";

export type { StickToBottomContext };

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export function Conversation({ className, ...props }: ConversationProps) {
  return (
    <StickToBottom
      className={cn(
        // StickToBottom.Content owns the scrollport; overflow-y-auto here
        // nests a second scroller and can trap wheel mid-thread (AI Elements #133).
        "relative min-h-0 flex-1 overflow-y-hidden",
        className,
      )}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export function ConversationContent({ className, scrollClassName, ...props }: ConversationContentProps) {
  return (
    <StickToBottom.Content
      className={cn("flex flex-col gap-4 p-4", className)}
      scrollClassName={cn("overscroll-contain", scrollClassName)}
      {...props}
    />
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

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export function ConversationScrollButton({ className, ...props }: ConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }

  return (
    <Button
      className={cn("absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full", className)}
      onClick={handleScrollToBottom}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  );
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
