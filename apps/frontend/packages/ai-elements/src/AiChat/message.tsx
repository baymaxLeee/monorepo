import { Bubble, BubbleContent } from "@repo/design-system/shadcn/bubble";
import { Button } from "@repo/design-system/shadcn/button";
import {
  Message as MessageRoot,
  MessageContent as MessageBody,
  MessageFooter,
} from "@repo/design-system/shadcn/message";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@repo/design-system/shadcn/tooltip";
import { cn } from "@repo/shared";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";

import "streamdown/styles.css";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

const MessageRoleContext = createContext<UIMessage["role"]>("assistant");

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <MessageRoleContext value={from}>
      <MessageRoot align={from === "user" ? "end" : "start"} className={cn("flex-col", className)} {...props} />
    </MessageRoleContext>
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ children, className, ...props }: MessageContentProps) {
  const role = useContext(MessageRoleContext);
  return (
    <MessageBody>
      {role === "user" ? (
        <Bubble align="end" variant="muted" className="max-w-full">
          <BubbleContent className={className} {...props}>
            {children}
          </BubbleContent>
        </Bubble>
      ) : (
        <div className={cn("min-w-0 text-sm leading-relaxed", className)} {...props}>
          {children}
        </div>
      )}
    </MessageBody>
  );
}

export type MessageActionsProps = ComponentProps<typeof MessageFooter>;

export function MessageActions({ className, ...props }: MessageActionsProps) {
  return <MessageFooter className={cn("gap-1 px-0", className)} {...props} />;
}

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export function MessageAction({
  tooltip,
  label,
  children,
  size = "icon-sm",
  variant = "ghost",
  ...props
}: MessageActionProps) {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label ?? tooltip}</span>
    </Button>
  );
  if (!tooltip) {
    return button;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type MessageBranchContextValue = {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
};

const MessageBranchContext = createContext<MessageBranchContextValue | null>(null);

function useMessageBranch() {
  const context = useContext(MessageBranchContext);
  if (!context) {
    throw new Error("MessageBranch components must be used within MessageBranch");
  }
  return context;
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export function MessageBranch({ defaultBranch = 0, onBranchChange, className, ...props }: MessageBranchProps) {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);
  const changeBranch = useCallback(
    (next: number) => {
      setCurrentBranch(next);
      onBranchChange?.(next);
    },
    [onBranchChange],
  );
  const goToPrevious = useCallback(
    () => changeBranch(currentBranch > 0 ? currentBranch - 1 : branches.length - 1),
    [branches.length, changeBranch, currentBranch],
  );
  const goToNext = useCallback(
    () => changeBranch(currentBranch < branches.length - 1 ? currentBranch + 1 : 0),
    [branches.length, changeBranch, currentBranch],
  );
  const value = useMemo(
    () => ({ branches, currentBranch, goToNext, goToPrevious, setBranches, totalBranches: branches.length }),
    [branches, currentBranch, goToNext, goToPrevious],
  );
  return (
    <MessageBranchContext.Provider value={value}>
      <div className={cn("grid w-full gap-2 [&>div]:pb-0", className)} {...props} />
    </MessageBranchContext.Provider>
  );
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageBranchContent({ children, ...props }: MessageBranchContentProps) {
  const { branches, currentBranch, setBranches } = useMessageBranch();
  const childrenArray = useMemo(() => (Array.isArray(children) ? children : [children]) as ReactElement[], [children]);
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [branches.length, childrenArray, setBranches]);
  return childrenArray.map((branch, index) => (
    <div
      className={cn("grid gap-2 overflow-hidden [&>div]:pb-0", index === currentBranch ? "block" : "hidden")}
      key={branch.key ?? index}
      {...props}
    >
      {branch}
    </div>
  ));
}

export type MessageBranchSelectorProps = ComponentProps<"div">;

export function MessageBranchSelector({ className, ...props }: MessageBranchSelectorProps) {
  const { totalBranches } = useMessageBranch();
  if (totalBranches <= 1) {
    return null;
  }
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export function MessageBranchPrevious({ children, ...props }: MessageBranchPreviousProps) {
  const { goToPrevious, totalBranches } = useMessageBranch();
  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
}

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export function MessageBranchNext({ children, ...props }: MessageBranchNextProps) {
  const { goToNext, totalBranches } = useMessageBranch();
  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export function MessageBranchPage({ className, ...props }: MessageBranchPageProps) {
  const { currentBranch, totalBranches } = useMessageBranch();
  return (
    <span className={cn("px-1 text-xs text-muted-foreground", className)} {...props}>
      {currentBranch + 1} of {totalBranches}
    </span>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full break-words leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && prevProps.isAnimating === nextProps.isAnimating,
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export function MessageToolbar({ className, children, ...props }: MessageToolbarProps) {
  return (
    <div className={cn("mt-3 flex w-full items-center justify-between gap-4", className)} {...props}>
      {children}
    </div>
  );
}
