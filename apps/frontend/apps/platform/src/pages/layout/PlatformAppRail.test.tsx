import { TooltipProvider } from "@repo/design-system";
import { usePlatformStore, type PlatformUser } from "@repo/runtime";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import { PlatformAppRail } from "./PlatformAppRail";

const apps = vi.hoisted(() => [
  {
    id: "chat",
    title: "Chat",
    base_path: "/platform/chat",
    remote_name: "chat",
    expose_key: "./routes",
    entry: "/chat/mf-manifest.json",
    requires_admin: false,
    is_enabled: true,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "canvas",
    title: "Canvas",
    base_path: "/platform/canvas",
    remote_name: "canvas",
    expose_key: "./routes",
    entry: "/canvas/mf-manifest.json",
    requires_admin: false,
    is_enabled: true,
    sort_order: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "admin",
    title: "Admin",
    base_path: "/platform/admin",
    remote_name: "admin",
    expose_key: "./routes",
    entry: "/admin/mf-manifest.json",
    requires_admin: true,
    is_enabled: true,
    sort_order: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
]);

vi.mock("../../router/app-registry", () => ({ loadApps: vi.fn(async () => apps) }));

const member: PlatformUser = {
  id: "user",
  account: "user",
  email: "user@example.test",
  displayName: "User",
  avatarUrl: "",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  theme: "system",
  marketingOptIn: false,
  emailVerified: true,
  roles: [],
  activeWorkspace: {
    tenantId: "tenant",
    workspaceId: "workspace",
    workspaceName: "Workspace",
    role: "member",
    status: "active",
  },
  memberships: [],
};

let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.innerHTML = "";
  usePlatformStore.getState().resetPlatformState();
});

test("keeps registry apps in the stable rail and applies the route access policy", async () => {
  usePlatformStore.getState().setUser(member);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={["/platform/canvas/projects"]}>
        <TooltipProvider>
          <PlatformAppRail />
        </TooltipProvider>
      </MemoryRouter>,
    );
  });

  expect(container.querySelector('a[aria-label="Chat"]')).toBeTruthy();
  expect(container.querySelector('a[aria-label="Canvas"]')?.getAttribute("aria-current")).toBe("page");
  expect(container.querySelector('a[aria-label="Admin"]')).toBeNull();
  const account = container.querySelector<HTMLButtonElement>('button[aria-label="账号：User"]');
  expect(account).toBeTruthy();
  await act(async () => account!.click());
  expect(document.body.textContent).toContain("个人资料");
  expect(document.body.textContent).toContain("记忆");
  expect(document.body.textContent).not.toContain("设置");

  await act(async () => {
    usePlatformStore.getState().setUser({
      ...member,
      activeWorkspace: { ...member.activeWorkspace!, role: "workspace_admin" },
    });
  });
  expect(container.querySelector('a[aria-label="Admin"]')).toBeTruthy();
});
