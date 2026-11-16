import {
  clearUser as clearObservabilityUser,
  recordPageView,
  setUser as setObservabilityUser,
} from "@repo/observability";
import { usePlatformStore } from "@repo/runtime";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { PlatformAppRail } from "./PlatformAppRail";

function Layout() {
  return (
    <div className="flex h-svh min-h-0 gap-1 overflow-hidden bg-muted p-2">
      <PlatformObservability />
      <PlatformAppRail />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm">
        <Outlet />
      </main>
    </div>
  );
}

function PlatformObservability() {
  const location = useLocation();
  const user = usePlatformStore((state) => state.user);

  useEffect(() => {
    recordPageView();
  }, [location.pathname]);

  useEffect(() => {
    if (user) {
      setObservabilityUser({
        userId: user.id,
        username: user.displayName,
      });
    } else {
      clearObservabilityUser();
    }
  }, [user]);

  return null;
}

export { Layout as Component };
