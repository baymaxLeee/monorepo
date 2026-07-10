import { bootstrapSession, onSessionChange } from "api";
import { Layout as LayoutFrame, Main } from "components";
import {
  clearUser as clearObservabilityUser,
  recordPageView,
  setUser as setObservabilityUser,
} from "observability";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { isSuperAdmin, landingPath } from "../../onboarding";
import { LoginLoadingCard } from "../login";

export function Layout() {
  const location = useLocation();
  const { user, setUser, resetPlatformState } = usePlatformStore((state) => ({
    user: state.user,
    setUser: state.setUser,
    resetPlatformState: state.resetPlatformState,
  }));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    bootstrapSession()
      .then((sessionUser) => {
        if (!alive) return;
        setUser(sessionUser);
        if (sessionUser) {
          setObservabilityUser({
            userId: sessionUser.id,
            username: sessionUser.displayName,
          });
        } else {
          clearObservabilityUser();
        }
      })
      .catch(() => {
        if (alive) {
          setUser(null);
          resetPlatformState();
          clearObservabilityUser();
        }
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [resetPlatformState, setUser]);

  useEffect(() => {
    return onSessionChange((sessionUser) => {
      setUser(sessionUser);
      if (!sessionUser) resetPlatformState();
    });
  }, [resetPlatformState, setUser]);

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

  if (!ready) return <LoginLoadingCard />;

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
