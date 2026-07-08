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

export function Layout() {
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
  // Org-scoped shell: an unbound non-super_admin can't use org resources yet;
  // route them to select-org / waiting room instead of an empty shell.
  if (!user.activeOrg && !isSuperAdmin(user)) {
    return <Navigate to={landingPath(user)} replace />;
  }

  // Platform is a transparent host: no global chrome DOM. Each mounted MFE
  // (chat as the primary shell, admin as the settings shell) renders its own
  // sidebar/header. See apps/frontend/AGENTS.md "Shell 布局".
  return (
    <LayoutFrame className="h-svh overflow-hidden">
      <Main className="overflow-y-auto">
        <Outlet />
      </Main>
    </LayoutFrame>
  );
}

export default Layout;
