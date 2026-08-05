import { TooltipContent } from "@repo/design-system/shadcn/tooltip";
import type React from "react";

type EditorTooltipContentProps = React.ComponentProps<typeof TooltipContent>;

function EditorTooltipContent({ side = "top", ...props }: EditorTooltipContentProps) {
  return <TooltipContent side={side} {...props} />;
}

export { EditorTooltipContent };
