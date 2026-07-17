import { Layout as LayoutFrame, Main } from "components";
import {
  clearUser as clearObservabilityUser,
  recordPageView,
  setUser as setObservabilityUser,
} from "observability";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { isSuperAdmin, landingPath } from "../../onboarding";

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

  if (!user) return <Navigate to="/login" replace />;
  if (!user.activeOrg && !isSuperAdmin(user)) {
    return <Navigate to={landingPath(user)} replace />;
  }

  return (
    <LayoutFrame className="h-svh overflow-hidden">
      <Main className="overflow-y-auto">
        <Outlet />
      </Main>
    </LayoutFrame>
  );
}

export { Layout as Component };
