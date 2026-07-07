import { Aside, Button, Layout, Main, Section } from "components";
import {
  AppWindowIcon,
  BotIcon,
  BrainCircuitIcon,
  Building2Icon,
  ComponentIcon,
  LibraryBigIcon,
  ListTreeIcon,
  type LucideIcon,
  NetworkIcon,
  RadarIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAdminIdentity } from "../identity";

type AdminMenuItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

const adminMenus: AdminMenuItem[] = [
  { title: "智能体", href: "/platform/admin/bots", icon: BotIcon },
  { title: "技能", href: "/platform/admin/skills", icon: SparklesIcon },
  { title: "场景", href: "/platform/admin/scenes", icon: ListTreeIcon },
  { title: "意图", href: "/platform/admin/intentions", icon: NetworkIcon },
  {
    title: "模型管理",
    href: "/platform/admin/providers",
    icon: BrainCircuitIcon,
  },
  {
    title: "知识库管理",
    href: "/platform/admin/knowledge",
    icon: LibraryBigIcon,
  },
];

const utilityMenus: AdminMenuItem[] = [
  {
    title: "可观测运维",
    href: "/platform/admin/observability",
    icon: RadarIcon,
  },
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
  const { isSuperAdmin, canViewMembers } = useAdminIdentity();

  const governanceMenus: AdminMenuItem[] = [];
  if (isSuperAdmin) {
    governanceMenus.push({
      title: "应用入口管理",
      href: "/platform/admin/apps",
      icon: AppWindowIcon,
    });
    governanceMenus.push({
      title: "组织管理",
      href: "/platform/admin/organizations",
      icon: Building2Icon,
    });
  }
  if (canViewMembers) {
    governanceMenus.push({
      title: "成员管理",
      href: "/platform/admin/members",
      icon: UsersIcon,
    });
  }
  if (isSuperAdmin) {
    governanceMenus.push({
      title: "平台角色",
      href: "/platform/admin/platform-roles",
      icon: ShieldCheckIcon,
    });
  }

  return (
    <Layout className="min-h-[calc(100svh-3.5rem)] flex-row">
      <Aside className="w-52 shrink-0 gap-6 p-3">
        <Section>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            管理配置
          </div>
          <MenuList items={adminMenus} />
        </Section>
        {governanceMenus.length > 0 && (
          <Section>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              组织与权限
            </div>
            <MenuList items={governanceMenus} />
          </Section>
        )}
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
