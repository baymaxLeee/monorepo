import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import { cn } from "@repo/shared";

export function Meter({ className, children, ...props }: MeterPrimitive.Root.Props) {
  return (
    <MeterPrimitive.Root data-slot="meter" className={cn("grid gap-2", className)} {...props}>
      {children}
      <MeterPrimitive.Track className="h-1.5 overflow-hidden rounded-full bg-muted">
        <MeterPrimitive.Indicator className="h-full bg-primary motion-safe:transition-[width]" />
      </MeterPrimitive.Track>
    </MeterPrimitive.Root>
  );
}
export const MeterLabel = MeterPrimitive.Label;
export const MeterValue = MeterPrimitive.Value;
