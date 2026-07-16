import { Aside, Button, Layout, Main, Section } from "components";
import {
  AppWindowIcon,
  ArrowLeftIcon,
  BotIcon,
  BrainCircuitIcon,
  Building2Icon,
  ComponentIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  LibraryBigIcon,
  type LucideIcon,
  RadarIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAdminIdentity } from "../identity";

type AdminMenuItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

const personalMenus: AdminMenuItem[] = [
  { title: "个人资料", href: "/platform/admin/profile", icon: UserIcon },
  {
    title: "仪表盘",
    href: "/platform/admin/dashboard",
    icon: LayoutDashboardIcon,
  },
];

const adminMenus: AdminMenuItem[] = [
  { title: "智能体", href: "/platform/admin/bots", icon: BotIcon },
  { title: "技能", href: "/platform/admin/skills", icon: SparklesIcon },
  {
    title: "模型",
    href: "/platform/admin/providers",
    icon: BrainCircuitIcon,
  },
  {
    title: "知识库",
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
  {
    title: "Trace 查询",
    href: "/platform/admin/traces",
    icon: GitBranchIcon,
  },
  { title: "组件演示", href: "/platform/admin/demo", icon: ComponentIcon },
];

function MenuList({ items }: { items: AdminMenuItem[] }) {
  const location = useLocation();

  return (
    <nav className="grid gap-0.5" aria-label="后台管理菜单">
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
            className="h-8 justify-start gap-2 px-2"
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
      title: "应用入口",
      href: "/platform/admin/apps",
      icon: AppWindowIcon,
    });
    governanceMenus.push({
      title: "组织",
      href: "/platform/admin/organizations",
      icon: Building2Icon,
    });
  }
  if (canViewMembers) {
    governanceMenus.push({
      title: "成员",
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
    <Layout className="h-svh min-h-0 flex-row overflow-hidden">
      <Aside className="w-52 shrink-0 gap-2 overflow-y-auto p-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 justify-start gap-2 self-start px-2 text-muted-foreground"
        >
          <Link to="/platform/chat">
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            返回应用
          </Link>
        </Button>
        <Section>
          <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
            个人
          </div>
          <MenuList items={personalMenus} />
        </Section>
        <Section>
          <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
            管理配置
          </div>
          <MenuList items={adminMenus} />
        </Section>
        {governanceMenus.length > 0 && (
          <Section>
            <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
              组织与权限
            </div>
            <MenuList items={governanceMenus} />
          </Section>
        )}
        <Section>
          <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
            开发
          </div>
          <MenuList items={utilityMenus} />
        </Section>
      </Aside>
      <Main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </Main>
    </Layout>
  );
}
