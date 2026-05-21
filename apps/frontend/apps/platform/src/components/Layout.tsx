import type { ReactNode } from "react";
import { logout, type AuthUser } from "@packages/auth-client";
import { cn } from "@packages/shared";
import { Link, useLocation } from "react-router-dom";
import { registry } from "../registry";

export function Layout({
  children,
  user,
  onUserChanged,
}: {
  children: ReactNode;
  user: AuthUser;
  onUserChanged: (user: AuthUser | null) => void;
}) {
  const location = useLocation();
  async function handleLogout() {
    await logout();
    onUserChanged(null);
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] font-sans">
      <header className="flex items-center gap-6 border-b bg-foreground px-6 py-3 text-background">
        <strong className="text-lg">Monorepo Demo (Shell)</strong>
        <nav className="flex gap-4">
          {registry.map((m) => {
            const active = location.pathname.startsWith(m.basePath);
            return (
              <Link
                key={m.id}
                to={m.basePath}
                className={cn(
                  "text-sm no-underline transition-colors",
                  active
                    ? "font-semibold text-background"
                    : "font-normal text-background/60",
                )}
              >
                {m.title}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-background/80">
            {user.displayName}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="cursor-pointer rounded-md border border-background/30 bg-transparent px-2.5 py-1.5 text-sm text-background hover:bg-background/10"
          >
            退出
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
