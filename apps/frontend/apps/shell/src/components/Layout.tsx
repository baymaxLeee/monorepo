import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { registry } from "../registry";

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        minHeight: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr",
      }}
    >
      <header
        style={{
          padding: "12px 24px",
          background: "#0f172a",
          color: "white",
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <strong style={{ fontSize: 18 }}>Monorepo Demo (Shell)</strong>
        <nav style={{ display: "flex", gap: 16 }}>
          {registry.map((m) => {
            const active = location.pathname.startsWith(m.basePath);
            return (
              <Link
                key={m.id}
                to={m.basePath}
                style={{
                  color: active ? "#fde047" : "#cbd5e1",
                  textDecoration: "none",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {m.title}
              </Link>
            );
          })}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
