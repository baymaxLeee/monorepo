import { NavLink, Outlet } from "react-router-dom";
import { Button, Separator } from "@packages/components";

const nav = [
  { to: ".", label: "智能体", end: true },
  { to: "demo", label: "组件演示", end: true },
] as const;

export function AdminLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <span className="text-sm font-semibold tracking-tight">Admin MFE</span>
          <Separator orientation="vertical" className="h-6" />
          <nav className="flex gap-1">
            {nav.map(({ to, label, end }) => (
              <Button key={to} variant="ghost" size="sm" asChild>
                <NavLink
                  to={to}
                  end={end}
                  relative="path"
                  className={({ isActive }) =>
                    isActive ? "bg-secondary text-secondary-foreground" : undefined
                  }
                >
                  {label}
                </NavLink>
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
