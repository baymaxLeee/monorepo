import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import {
  bootstrapSession,
  getCurrentUser,
  type AuthSession,
  type AuthUser,
} from "@packages/auth-client";
import { registry } from "./registry";
import { Layout } from "./components/Layout";
import { AuthPage } from "./pages/AuthPage";

// Lazy-load each MFE entry via Module Federation.
// The "mfe_admin/App" specifier is resolved by the MF host at runtime.
const AdminApp = lazy(() => import("mfe_admin/App"));

export function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    let cancelled = false;
    bootstrapSession()
      .then((sessionUser) => {
        if (!cancelled) setUser(sessionUser);
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAuthenticated(session: AuthSession) {
    setUser(session.user);
  }

  if (bootstrapping) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  return (
    <BrowserRouter>
      {user ? (
        <Layout user={user} onUserChanged={setUser}>
          <Routes>
            <Route path="/" element={<Navigate to="/bots" replace />} />
            <Route
              path="/bots/*"
              element={
                <Suspense
                  fallback={
                    <div style={{ padding: 16 }}>Loading admin module…</div>
                  }
                >
                  <AdminApp />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <div style={{ padding: 24 }}>
                  <h2>404</h2>
                  <p>
                    No route matched. Try one of:{" "}
                    {registry.map((m) => (
                      <Link
                        key={m.id}
                        to={m.basePath}
                        style={{ marginRight: 12 }}
                      >
                        {m.title}
                      </Link>
                    ))}
                  </p>
                </div>
              }
            />
          </Routes>
        </Layout>
      ) : (
        <Routes>
          <Route
            path="/auth"
            element={<AuthPage onAuthenticated={handleAuthenticated} />}
          />
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
