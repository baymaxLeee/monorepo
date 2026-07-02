import type React from "react";

import { TooltipContent } from "../../shadcn/tooltip";

type EditorTooltipContentProps = React.ComponentProps<typeof TooltipContent>;

function EditorTooltipContent({
  side = "top",
  ...props
}: EditorTooltipContentProps) {
  return <TooltipContent side={side} {...props} />;
}

export { EditorTooltipContent };
