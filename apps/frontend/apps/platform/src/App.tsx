import { Suspense, lazy } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { registry } from "./registry";
import { Layout } from "./components/Layout";

// Lazy-load each MFE entry via Module Federation.
// The "mfe_admin/App" specifier is resolved by the MF host at runtime.
const AdminApp = lazy(() => import("mfe_admin/App"));

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/bots" replace />} />
          <Route
            path="/bots/*"
            element={
              <Suspense fallback={<div style={{ padding: 16 }}>Loading admin module…</div>}>
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
                    <Link key={m.id} to={m.basePath} style={{ marginRight: 12 }}>
                      {m.title}
                    </Link>
                  ))}
                </p>
              </div>
            }
          />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
