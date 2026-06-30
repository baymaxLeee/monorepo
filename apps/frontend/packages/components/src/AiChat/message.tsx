import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { cn } from "shared";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        "group flex w-full flex-col gap-2",
        from === "user"
          ? "is-user ml-auto max-w-[min(100%,40rem)] items-end"
          : "is-assistant max-w-[min(100%,48rem)] items-start",
        className,
      )}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({
  children,
  className,
  ...props
}: MessageContentProps) {
  return (
    <div
      className={cn(
        "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm leading-relaxed",
        "group-[.is-user]:rounded-2xl group-[.is-user]:border group-[.is-user]:border-border/60 group-[.is-user]:bg-muted group-[.is-user]:px-3.5 group-[.is-user]:py-2.5 group-[.is-user]:text-foreground group-[.is-user]:shadow-sm",
        "group-[.is-assistant]:rounded-lg group-[.is-assistant]:bg-transparent group-[.is-assistant]:px-0 group-[.is-assistant]:py-1 group-[.is-assistant]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageActionsProps = ComponentProps<"div">;

export function MessageActions({
  className,
  children,
  ...props
}: MessageActionsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)} {...props}>
      {children}
    </div>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full break-words leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.isAnimating === nextProps.isAnimating,
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export function MessageToolbar({
  className,
  children,
  ...props
}: MessageToolbarProps) {
  return (
    <div
      className={cn(
        "mt-3 flex w-full items-center justify-between gap-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
