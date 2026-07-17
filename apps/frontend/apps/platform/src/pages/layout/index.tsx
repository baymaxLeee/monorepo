import { Layout as LayoutFrame, Main } from "components";
import {
  clearUser as clearObservabilityUser,
  recordPageView,
  setUser as setObservabilityUser,
} from "observability";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { usePlatformStore } from "runtime";

function Layout() {
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

  return (
    <LayoutFrame className="h-svh overflow-hidden">
      <Main className="overflow-y-auto">
        <Outlet />
      </Main>
    </LayoutFrame>
  );
}

export { Layout as Component };
