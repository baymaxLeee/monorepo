import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { cn } from "@repo/shared";
import { BrainIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useState } from "react";

import { MessageResponse } from "./message";

type ReasoningContextValue = {
  isOpen: boolean;
  isStreaming: boolean;
  duration?: number;
  setIsOpen: (open: boolean) => void;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context) throw new Error("Reasoning components must be used within Reasoning");
  return context;
}

export type ReasoningProps = ComponentProps<"div"> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

export function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration,
  children,
  ...props
}: ReasoningProps) {
  // An explicit user choice wins over automatic streaming open/close transitions.
  const [userOpen, setUserOpen] = useState<boolean | undefined>(defaultOpen);
  const isOpen = open ?? userOpen ?? isStreaming;
  const setIsOpen = (next: boolean) => {
    setUserOpen(next);
    onOpenChange?.(next);
  };
  return (
    <ReasoningContext value={{ isOpen, isStreaming, duration, setIsOpen }}>
      <Trace className={cn("not-prose", className)} {...props}>
        <TraceCollapsible open={isOpen} onOpenChange={setIsOpen}>
          {children}
        </TraceCollapsible>
      </Trace>
    </ReasoningContext>
  );
}

export type ReasoningTriggerProps = ComponentProps<typeof TraceCollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

function thinkingMessage(streaming: boolean, duration?: number) {
  return streaming ? "思考中…" : duration === undefined ? "思考过程" : `思考了 ${duration} 秒`;
}

export function ReasoningTrigger({ children, getThinkingMessage = thinkingMessage, ...props }: ReasoningTriggerProps) {
  const { duration, isStreaming } = useReasoning();
  return (
    <TraceCollapsibleTrigger {...props}>
      <TraceLine status={isStreaming ? "running" : undefined}>
        <TraceIcon>
          <BrainIcon />
        </TraceIcon>
        <TraceTitle>{children ?? getThinkingMessage(isStreaming, duration)}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}

export type ReasoningContentProps = ComponentProps<"div"> & { children: string };

export function ReasoningContent({ className, children, ...props }: ReasoningContentProps) {
  const { isStreaming } = useReasoning();
  return (
    <TraceCollapsibleContent keepMounted className={cn("max-h-96 overflow-y-auto text-sm", className)} {...props}>
      <MessageResponse isAnimating={isStreaming}>{children}</MessageResponse>
    </TraceCollapsibleContent>
  );
}
