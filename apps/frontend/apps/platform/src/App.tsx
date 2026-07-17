import { QueryClientProvider } from "@tanstack/react-query";
import { onSessionChange } from "api";
import { ErrorBoundary, Toaster, TooltipProvider } from "components";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { useShallow } from "zustand/react/shallow";
import { isSuperAdmin } from "./onboarding";
import { queryClient } from "./query-client";
import { RouteLoading, router } from "./router";
import { resetApps } from "./router/app-registry";

export function App() {
  const { user, setUser, resetPlatformState } = usePlatformStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
      resetPlatformState: state.resetPlatformState,
    })),
  );
  const canEnter = !!user && (!!user.activeOrg || isSuperAdmin(user));
  const activeOrgId = user?.activeOrg?.orgId ?? null;

  useEffect(() => {
    return onSessionChange((sessionUser) => {
      setUser(sessionUser);
      if (!sessionUser) {
        resetPlatformState();
        queryClient.clear();
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
          <RouterProvider
            router={router}
            fallbackElement={<RouteLoading />}
            future={{ v7_startTransition: true }}
          />
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
