import {
  Suspense,
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { bootstrapSession, type AuthSession } from "@packages/api";
import { Muted, Skeleton } from "@packages/components";
import { usePlatformStore, type PlatformUser } from "@packages/runtime";
import { defaultAppPath, HOME_PATH, LOGIN_PATH, registry } from "./registry";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppProviders } from "./components/AppProviders";
import { Layout } from "./components/Layout";
import { RemoteErrorBoundary } from "./components/RemoteErrorBoundary";
import { AuthLoadingCard } from "./pages/AuthLoadingCard";
import { AuthPage } from "./pages/AuthPage";

const AdminApp = lazy(() => import("mfe_admin/App"));

const remoteApps: Record<string, LazyExoticComponent<ComponentType>> = {
  mfe_admin: AdminApp,
};

function isLoginPath(pathname: string) {
  return pathname === LOGIN_PATH || pathname === "/login/";
}

function MfeFallback({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col gap-3 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Muted>Loading {title}…</Muted>
    </div>
  );
}

function AuthenticatedRoutes({
  user,
  onUserChanged,
}: {
  user: PlatformUser;
  onUserChanged: (user: PlatformUser | null) => void;
}) {
  return (
    <Layout user={user} onUserChanged={onUserChanged}>
      <Routes>
        <Route
          path={HOME_PATH}
          element={<Navigate to={defaultAppPath} replace />}
        />
        {registry.map((m) => {
          const Remote = remoteApps[m.remoteName];
          if (!Remote) return null;
          return (
            <Route
              key={m.id}
              path={`${m.basePath}/*`}
              element={
                <RemoteErrorBoundary remoteName={m.remoteName}>
                  <Suspense fallback={<MfeFallback title={m.title} />}>
                    <Remote />
                  </Suspense>
                </RemoteErrorBoundary>
              }
            />
          );
        })}
        <Route
          path={LOGIN_PATH}
          element={<Navigate to={defaultAppPath} replace />}
        />
        <Route path="*" element={<Navigate to={defaultAppPath} replace />} />
      </Routes>
    </Layout>
  );
}

function AppRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = usePlatformStore((state) => state.user);
  const setUser = usePlatformStore((state) => state.setUser);
  const setMenus = usePlatformStore((state) => state.setMenus);
  const [ready, setReady] = useState(false);
  const onLogin = isLoginPath(location.pathname);

  useEffect(() => {
    setMenus(
      registry.map((m) => ({
        id: m.id,
        title: m.title,
        basePath: m.basePath,
        subNav: m.subNav,
      })),
    );
  }, [setMenus]);

  useEffect(() => {
    let alive = true;
    bootstrapSession()
      .then((sessionUser) => {
        if (alive) setUser(sessionUser);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function handleAuthenticated(session: AuthSession) {
    setUser(session.user);
    navigate(defaultAppPath, { replace: true });
  }

  if (!ready) {
    if (onLogin) {
      return (
        <Routes>
          <Route path={LOGIN_PATH} element={<AuthLoadingCard />} />
          <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
        </Routes>
      );
    }
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="w-full max-w-xs space-y-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-full" />
          <Muted>正在恢复会话…</Muted>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path={LOGIN_PATH}
        element={
          user ? (
            <Navigate to={defaultAppPath} replace />
          ) : (
            <AuthPage onAuthenticated={handleAuthenticated} />
          )
        }
      />
      {user ? (
        <Route
          path="*"
          element={<AuthenticatedRoutes user={user} onUserChanged={setUser} />}
        />
      ) : (
        <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
      )}
    </Routes>
  );
}

export function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
