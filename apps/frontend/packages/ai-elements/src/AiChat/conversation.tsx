import { Button } from "@repo/design-system/shadcn/button";
import { cn } from "@repo/shared";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { useCallback, useImperativeHandle } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationScrollHandle = { scrollToEnd: () => void };

export type ConversationProps = ComponentProps<typeof StickToBottom> & {
  scrollRef?: Ref<ConversationScrollHandle>;
};

function ScrollHandle({ scrollRef }: Pick<ConversationProps, "scrollRef">) {
  const { scrollToBottom } = useStickToBottomContext();
  useImperativeHandle(
    scrollRef,
    () => ({
      scrollToEnd: () => {
        void scrollToBottom({ animation: "instant" });
      },
    }),
    [scrollToBottom],
  );
  return null;
}

export function Conversation({ className, scrollRef, children, ...props }: ConversationProps) {
  return (
    <StickToBottom
      initial="instant"
      resize="instant"
      className={cn("relative min-h-0 flex-1 overflow-hidden", className)}
      {...props}
    >
      {(context) => (
        <>
          <ScrollHandle scrollRef={scrollRef} />
          {typeof children === "function" ? children(context) : children}
        </>
      )}
    </StickToBottom>
  );
}

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export function ConversationContent({ className, scrollClassName, ...props }: ConversationContentProps) {
  return (
    <StickToBottom.Content
      scrollClassName={cn("min-h-0 min-w-0 overflow-auto overscroll-contain", scrollClassName)}
      className={cn("flex flex-col gap-4 p-4", className)}
      role="log"
      aria-relevant="additions"
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

export function ConversationScrollButton({ className, onClick, children, ...props }: ConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return !isAtBottom ? (
    <Button
      className={cn("absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full", className)}
      aria-label="回到底部"
      size="icon-sm"
      variant="outline"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void scrollToBottom({ animation: "instant" });
      }}
      {...props}
    >
      {children ?? <ArrowDownIcon />}
    </Button>
  ) : null;
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
