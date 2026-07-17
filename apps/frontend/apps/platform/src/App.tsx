import { QueryClientProvider } from "@tanstack/react-query";
import { onSessionChange } from "api";
import { ErrorBoundary, Toaster, TooltipProvider } from "components";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { useShallow } from "zustand/react/shallow";
import { canEnterPlatform } from "./onboarding";
import { queryClient } from "./query-client";
import { router } from "./router";
import { resetApps } from "./router/app-registry";

export function App() {
  const { user, setUser, resetPlatformState } = usePlatformStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
      resetPlatformState: state.resetPlatformState,
    })),
  );
  const canEnter = !!user && canEnterPlatform(user);
  const activeOrgId = user?.activeOrg?.orgId ?? null;

  useEffect(() => {
    return onSessionChange((sessionUser) => {
      const hadUser = usePlatformStore.getState().user !== null;
      setUser(sessionUser);
      if (!sessionUser) {
        resetPlatformState();
        queryClient.clear();
        if (hadUser) router.revalidate();
      }
    });
  }, [resetPlatformState, setUser]);

  useEffect(() => {
    resetApps();
  }, [canEnter, activeOrgId]);

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
