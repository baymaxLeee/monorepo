import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "shared";
import { MessageResponse } from "./message";

type ReasoningContextValue = {
  isOpen: boolean;
  isStreaming: boolean;
  duration?: number;
  setIsOpen: (open: boolean) => void;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context)
    throw new Error("Reasoning components must be used within Reasoning");
  return context;
}

export type ReasoningProps = ComponentProps<"div"> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
  autoOpenOnStream?: boolean;
  autoCloseOnFinish?: boolean;
  autoCloseDelay?: number;
};

const DEFAULT_AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration: durationProp,
  autoOpenOnStream = false,
  autoCloseOnFinish = false,
  autoCloseDelay = DEFAULT_AUTO_CLOSE_DELAY,
  children,
  ...props
}: ReasoningProps) {
  const [localOpen, setLocalOpen] = useState(defaultOpen ?? false);
  const [duration, setDuration] = useState<number | undefined>(durationProp);
  const [hasAutoClosed, setHasAutoClosed] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const hasAutoOpenedRef = useRef(false);
  const isOpen = open ?? localOpen;

  const setIsOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (durationProp !== undefined) setDuration(durationProp);
  }, [durationProp]);

  useEffect(() => {
    if (isStreaming) {
      startTimeRef.current ??= Date.now();
      setHasAutoClosed(false);
      if (autoOpenOnStream && !isOpen) {
        hasAutoOpenedRef.current = true;
        setIsOpen(true);
      }
      return;
    }
    if (startTimeRef.current !== null) {
      setDuration(Math.ceil((Date.now() - startTimeRef.current) / 1000));
      startTimeRef.current = null;
    }
  }, [autoOpenOnStream, isOpen, isStreaming]);

  useEffect(() => {
    if (
      !autoCloseOnFinish ||
      !hasAutoOpenedRef.current ||
      hasAutoClosed ||
      isStreaming ||
      !isOpen
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setIsOpen(false);
      setHasAutoClosed(true);
      hasAutoOpenedRef.current = false;
    }, autoCloseDelay);
    return () => window.clearTimeout(timer);
  }, [autoCloseDelay, autoCloseOnFinish, hasAutoClosed, isOpen, isStreaming]);

  const value = useMemo(
    () => ({ duration, isOpen, isStreaming, setIsOpen }),
    [duration, isOpen, isStreaming],
  );

  return (
    <ReasoningContext.Provider value={value}>
      <div className={cn("not-prose space-y-2", className)} {...props}>
        {children}
      </div>
    </ReasoningContext.Provider>
  );
});

export type ReasoningTriggerProps = ComponentProps<"button"> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

function defaultThinkingMessage(isStreaming: boolean, duration?: number) {
  if (isStreaming || duration === 0) return "Thinking...";
  if (duration === undefined) return "Thought for a few seconds";
  return `Thought for ${duration} seconds`;
}

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultThinkingMessage,
  ...props
}: ReasoningTriggerProps) {
  const { duration, isOpen, isStreaming, setIsOpen } = useReasoning();
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      type="button"
      onClick={() => setIsOpen(!isOpen)}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon className="size-4" />
          <span>{getThinkingMessage(isStreaming, duration)}</span>
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </>
      )}
    </button>
  );
});

export type ReasoningContentProps = ComponentProps<"div"> & {
  children: string;
};

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  const { isOpen } = useReasoning();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [children, isOpen]);

  return (
    <div
      ref={contentRef}
      className={cn(
        "text-sm leading-5 text-muted-foreground transition-[max-height]",
        isOpen
          ? "max-h-[min(24rem,50vh)] overflow-y-auto"
          : "max-h-[3.75rem] overflow-hidden",
        className,
      )}
      {...props}
    >
      <MessageResponse className="leading-5">{children}</MessageResponse>
    </div>
  );
});
