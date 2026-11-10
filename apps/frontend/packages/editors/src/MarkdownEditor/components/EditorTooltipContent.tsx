import { TooltipContent } from "@repo/design-system/shadcn/tooltip";
import type React from "react";

import { useEditorContext } from "../context";

type EditorTooltipContentProps = React.ComponentProps<typeof TooltipContent>;

function EditorTooltipContent({ container, side = "top", ...props }: EditorTooltipContentProps) {
  const { portal } = useEditorContext();
  return <TooltipContent container={container ?? portal.getPopupContainer()} side={side} {...props} />;
}

export { EditorTooltipContent };
