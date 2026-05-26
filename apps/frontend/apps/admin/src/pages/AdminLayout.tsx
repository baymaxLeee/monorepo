import {
  BotIcon,
  ComponentIcon,
  ListTreeIcon,
  NetworkIcon,
  RadarIcon,
  type LucideIcon,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Aside, Button, Layout, Main, Section } from "components";

type AdminMenuItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

const adminMenus: AdminMenuItem[] = [
  { title: "智能体", href: "/platform/admin/bots", icon: BotIcon },
  { title: "场景", href: "/platform/admin/scenes", icon: ListTreeIcon },
  { title: "意图", href: "/platform/admin/intentions", icon: NetworkIcon },
];

const utilityMenus: AdminMenuItem[] = [
  { title: "可观测运维", href: "/platform/admin/observability", icon: RadarIcon },
  { title: "组件演示", href: "/platform/admin/demo", icon: ComponentIcon },
];

function MenuList({ items }: { items: AdminMenuItem[] }) {
  const location = useLocation();

  return (
    <nav className="grid gap-1" aria-label="后台管理菜单">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          location.pathname === item.href ||
          location.pathname.startsWith(`${item.href}/`);

        return (
          <Button
            key={item.href}
            asChild
            variant={active ? "secondary" : "ghost"}
            className="justify-start gap-2"
          >
            <Link to={item.href}>
              <Icon aria-hidden="true" className="size-4" />
              {item.title}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

export function AdminLayout() {
  return (
    <Layout className="min-h-[calc(100svh-3.5rem)] flex-row">
      <Aside className="w-52 shrink-0 gap-6 p-3">
        <Section>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            管理配置
          </div>
          <MenuList items={adminMenus} />
        </Section>
        <Section>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            开发
          </div>
          <MenuList items={utilityMenus} />
        </Section>
      </Aside>
      <Main className="overflow-auto">
        <Outlet />
      </Main>
    </Layout>
  );
}
