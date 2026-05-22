import type { ReactNode } from "react";
import { Toaster, TooltipProvider } from "@packages/components";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </TooltipProvider>
  );
}
