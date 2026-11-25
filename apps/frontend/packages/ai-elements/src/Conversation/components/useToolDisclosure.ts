import { useCallback, useState } from "react";

type DisclosurePhase = "active" | "settled";

export function useToolDisclosure(settled: boolean) {
  const phase: DisclosurePhase = settled ? "settled" : "active";
  const [choice, setChoice] = useState<{ phase: DisclosurePhase; open: boolean }>();
  const onOpenChange = useCallback((open: boolean) => setChoice({ phase, open }), [phase]);
  return {
    open: choice?.phase === phase ? choice.open : phase === "active",
    onOpenChange,
  };
}
