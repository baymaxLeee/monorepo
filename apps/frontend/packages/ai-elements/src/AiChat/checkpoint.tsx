import { Button } from "@repo/design-system/shadcn/button";
import { Marker, MarkerContent, MarkerIcon } from "@repo/design-system/shadcn/marker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/design-system/shadcn/tooltip";
import type { ComponentProps } from "react";

export function Checkpoint({ children, ...props }: ComponentProps<typeof Marker>) {
  return (
    <Marker variant="separator" {...props}>
      <MarkerContent className="flex items-center gap-2">{children}</MarkerContent>
    </Marker>
  );
}
export const CheckpointIcon = MarkerIcon;
export function CheckpointTrigger({
  tooltip,
  children = "恢复到此处",
  ...props
}: ComponentProps<typeof Button> & { tooltip?: string }) {
  const button = (
    <Button type="button" size="xs" variant="outline" {...props}>
      {children}
    </Button>
  );
  return tooltip ? (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
}
