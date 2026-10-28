import { Badge } from "@repo/design-system/shadcn/badge";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { BotIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { MessageResponse } from "./message";
import { workflowTraceStatus, type WorkflowStatus } from "./workflow";

export type SubagentProps = ComponentProps<typeof TraceCollapsible>;
export function Subagent(props: SubagentProps) {
  return (
    <Trace>
      <TraceCollapsible {...props} />
    </Trace>
  );
}
export type SubagentHeaderProps = ComponentProps<typeof TraceCollapsibleTrigger> & {
  name: string;
  model?: string;
  status?: WorkflowStatus;
};
export function SubagentHeader({ name, model, status, ...props }: SubagentHeaderProps) {
  return (
    <TraceCollapsibleTrigger {...props}>
      <TraceLine status={workflowTraceStatus(status)}>
        <TraceIcon>
          <BotIcon />
        </TraceIcon>
        <TraceTitle>{name}</TraceTitle>
        {model ? <Badge variant="secondary">{model}</Badge> : null}
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}
export function SubagentContent({ children, ...props }: ComponentProps<typeof TraceCollapsibleContent>) {
  return (
    <TraceCollapsibleContent keepMounted {...props}>
      <Trace>{children}</Trace>
    </TraceCollapsibleContent>
  );
}
export function SubagentOutput(props: ComponentProps<typeof MessageResponse>) {
  return <MessageResponse {...props} />;
}
