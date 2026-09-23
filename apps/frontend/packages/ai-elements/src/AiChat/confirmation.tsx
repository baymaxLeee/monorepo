import { Alert, AlertDescription } from "@repo/design-system/shadcn/alert";
import { Button } from "@repo/design-system/shadcn/button";
import { cn } from "@repo/shared";
import type { ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

type ToolApproval = ToolUIPart["approval"];

type ConfirmationContextValue = {
  approval: ToolApproval;
  state: ToolUIPart["state"];
};

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

function useConfirmation() {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error("Confirmation parts must be rendered inside Confirmation");
  }
  return context;
}

export type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ToolApproval;
  state: ToolUIPart["state"];
};

export function Confirmation({ approval, state, className, ...props }: ConfirmationProps) {
  const value = useMemo(() => ({ approval, state }), [approval, state]);
  if (!approval || state === "input-streaming" || state === "input-available") {
    return null;
  }
  return (
    <ConfirmationContext.Provider value={value}>
      <Alert className={cn("flex flex-col gap-2", className)} {...props} />
    </ConfirmationContext.Provider>
  );
}

export type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>;

export function ConfirmationTitle(props: ConfirmationTitleProps) {
  return <AlertDescription {...props} />;
}

export interface ConfirmationRequestProps {
  children?: ReactNode;
}

export function ConfirmationRequest({ children }: ConfirmationRequestProps) {
  return useConfirmation().state === "approval-requested" ? children : null;
}

export interface ConfirmationAcceptedProps {
  children?: ReactNode;
}

export function ConfirmationAccepted({ children }: ConfirmationAcceptedProps) {
  const { approval, state } = useConfirmation();
  return approval?.approved === true && ["approval-responded", "output-available"].includes(state) ? children : null;
}

export interface ConfirmationRejectedProps {
  children?: ReactNode;
}

export function ConfirmationRejected({ children }: ConfirmationRejectedProps) {
  const { approval, state } = useConfirmation();
  return approval?.approved === false && ["approval-responded", "output-denied", "output-available"].includes(state)
    ? children
    : null;
}

export type ConfirmationActionsProps = ComponentProps<"div">;

export function ConfirmationActions({ className, ...props }: ConfirmationActionsProps) {
  if (useConfirmation().state !== "approval-requested") {
    return null;
  }
  return <div className={cn("flex items-center justify-end gap-2", className)} {...props} />;
}

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export function ConfirmationAction(props: ConfirmationActionProps) {
  return <Button className="h-8 px-3 text-sm" type="button" {...props} />;
}
