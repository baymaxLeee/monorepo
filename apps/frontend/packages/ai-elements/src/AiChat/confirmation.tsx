import { Button } from "@repo/design-system/shadcn/button";
import { Item, ItemContent, ItemTitle, ItemActions } from "@repo/design-system/shadcn/item";
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

export type ConfirmationProps = ComponentProps<typeof Item> & {
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
      <Item variant="outline" size="sm" className={cn("flex flex-col gap-2", className)} {...props} />
    </ConfirmationContext.Provider>
  );
}

export type ConfirmationTitleProps = ComponentProps<typeof ItemTitle>;

export function ConfirmationTitle(props: ConfirmationTitleProps) {
  return (
    <ItemContent>
      <ItemTitle {...props} />
    </ItemContent>
  );
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
  return <ItemActions className={cn("justify-end", className)} {...props} />;
}

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export function ConfirmationAction(props: ConfirmationActionProps) {
  return <Button className="h-8 px-3 text-sm" type="button" {...props} />;
}
