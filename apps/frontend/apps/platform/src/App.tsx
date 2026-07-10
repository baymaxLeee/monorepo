import { QueryClientProvider } from "@tanstack/react-query";
import { onSessionChange } from "api";
import { ErrorBoundary, Toaster, TooltipProvider } from "components";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { isSuperAdmin } from "./onboarding";
import { queryClient } from "./query-client";
import { router } from "./router";
import { loadApps, resetApps } from "./store/apps";

export function App() {
  const { user, setUser, resetPlatformState } = usePlatformStore((state) => ({
    user: state.user,
    setUser: state.setUser,
    resetPlatformState: state.resetPlatformState,
  }));
  // App visibility is org-scoped: only fetch entitlements once the session is
  // bound to an org (or the caller is a platform super_admin). Re-fetch when the
  // active org changes so a switch never shows the previous org's apps.
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
    if (!canEnter) {
      resetApps();
      return;
    }
    resetApps();
    loadApps();
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
            future={{ v7_startTransition: true }}
          />
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
