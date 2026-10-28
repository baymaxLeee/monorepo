import { Badge } from "@repo/design-system/shadcn/badge";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { BrainIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export type ChainOfThoughtProps = ComponentProps<typeof TraceCollapsible>;
export function ChainOfThought(props: ChainOfThoughtProps) {
  return (
    <Trace>
      <TraceCollapsible {...props} />
    </Trace>
  );
}
export function ChainOfThoughtHeader({
  children = "执行过程",
  ...props
}: ComponentProps<typeof TraceCollapsibleTrigger>) {
  return (
    <TraceCollapsibleTrigger {...props}>
      <TraceLine>
        <TraceIcon>
          <BrainIcon />
        </TraceIcon>
        <TraceTitle>{children}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}
export function ChainOfThoughtContent({ children, ...props }: ComponentProps<typeof TraceCollapsibleContent>) {
  return (
    <TraceCollapsibleContent keepMounted {...props}>
      <Trace>{children}</Trace>
    </TraceCollapsibleContent>
  );
}
export type ChainOfThoughtStepProps = Omit<ComponentProps<typeof TraceLine>, "status"> & {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  status?: "active" | "pending" | "complete" | "error";
};
export function ChainOfThoughtStep({ label, description, icon, status, children, ...props }: ChainOfThoughtStepProps) {
  return (
    <TraceLine status={status === "active" ? "running" : status === "complete" ? undefined : status} {...props}>
      {icon ? <TraceIcon>{icon}</TraceIcon> : null}
      <TraceTitle>{label}</TraceTitle>
      {description ? <TraceDescription>{description}</TraceDescription> : null}
      {children}
    </TraceLine>
  );
}
export function ChainOfThoughtSearchResults(props: ComponentProps<"div">) {
  return <div className="flex flex-wrap gap-2" {...props} />;
}
export function ChainOfThoughtSearchResult(props: ComponentProps<typeof Badge>) {
  return <Badge variant="secondary" {...props} />;
}
