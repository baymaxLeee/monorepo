import { Layout as LayoutFrame, Main } from "@repo/design-system";
import {
  clearUser as clearObservabilityUser,
  recordPageView,
  setUser as setObservabilityUser,
} from "@repo/observability";
import { usePlatformStore } from "@repo/runtime";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";

function Layout() {
  return (
    <LayoutFrame className="h-svh overflow-hidden">
      <PlatformObservability />
      <Main className="overflow-y-auto">
        <Outlet />
      </Main>
    </LayoutFrame>
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
