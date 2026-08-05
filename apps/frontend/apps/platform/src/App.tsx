import { onSessionChange } from "@repo/api";
import { ErrorBoundary, Toaster, TooltipProvider } from "@repo/design-system";
import { usePlatformStore } from "@repo/runtime";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { queryClient } from "./query-client";
import { router } from "./router";

export function App() {
  const { setUser, resetPlatformState } = usePlatformStore(
    useShallow((state) => ({
      setUser: state.setUser,
      resetPlatformState: state.resetPlatformState,
    })),
  );
  useEffect(() => {
    return onSessionChange((sessionUser) => {
      const hadUser = usePlatformStore.getState().user !== null;
      if (sessionUser) {
        setUser(sessionUser);
        return;
      }
      resetPlatformState();
      queryClient.clear();
      if (hadUser) {
        router.revalidate();
      }
    });
  }, [resetPlatformState, setUser]);

  return (
    <ErrorBoundary
      onError={(error, info) => {
        console.error("[platform] render error", error, info);
      }}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
