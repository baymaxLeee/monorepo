import { ErrorBoundary, Toaster, TooltipProvider } from "components";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { router } from "./router";
import { loadApps } from "./store/apps";

export function App() {
  const user = usePlatformStore((state) => state.user);

  useEffect(() => {
    if (user) loadApps();
  }, [user]);

  return (
    <ErrorBoundary
      onError={(error, info) => {
        console.error("[platform] render error", error, info);
      }}
    >
      <TooltipProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
        <Toaster richColors closeButton position="top-right" />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
