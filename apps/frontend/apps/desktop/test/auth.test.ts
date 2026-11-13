import { beforeEach, expect, it, vi } from "vitest";
const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch } }));
import { DesktopAuth } from "../electron/auth";
import { platformUrl } from "../electron/platform-url";
const user = { id: "user", activeWorkspace: { tenantId: "tenant", workspaceId: "workspace", status: "active" } };
const expires = "2099-01-01T00:00:00Z";
beforeEach(() => fetch.mockReset());
it("refresh is single-flight and logout fences a late refresh result", async () => {
  const scopes: (string | null)[] = [];
  const auth = new DesktopAuth("https://platform.test", async (scope) => {
    scopes.push(scope);
  });
  fetch.mockResolvedValueOnce(Response.json(user));
  await auth.bind("token", expires);
  let deliver!: (response: Response) => void;
  fetch.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      deliver = resolve;
    }),
  );
  const first = auth.refresh(),
    second = auth.refresh();
  const outcome = Promise.allSettled([first, second]);
  await auth.clear();
  deliver(Response.json({ accessToken: "new", expiresAt: expires, user }));
  expect((await outcome).every((result) => result.status === "rejected")).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(scopes.at(-1)).toBe(null);
  await expect(auth.fetch("/api/chat-server/local-inference/config")).rejects.toThrow("登录");
});
it("unapproved accounts keep Web auth but receive no local scope", async () => {
  const change = vi.fn(async () => {}),
    auth = new DesktopAuth("https://platform.test", change);
  fetch.mockResolvedValueOnce(
    Response.json({ accessToken: "new", expiresAt: expires, user: { id: "u", activeWorkspace: null } }),
  );
  expect((await auth.refresh()).accessToken).toBe("new");
  expect(change).not.toHaveBeenCalled();
  await expect(auth.fetch("/api/chat-server/local-inference/config")).rejects.toThrow("工作区");
});
it("cannot act as a generic authenticated proxy", async () => {
  const auth = new DesktopAuth("https://platform.test", async () => {});
  await expect(auth.fetch("https://evil.test")).rejects.toThrow("未授权");
  expect(fetch).not.toHaveBeenCalled();
});
it("pins a root Platform origin and explicitly opts in to remote HTTP", () => {
  expect(platformUrl("http://localhost:3000").origin).toBe("http://localhost:3000");
  expect(platformUrl("https://platform.test").origin).toBe("https://platform.test");
  expect(() => platformUrl("http://vps.test")).toThrow();
  expect(platformUrl("http://vps.test", true).hostname).toBe("vps.test");
  for (const value of ["file:///tmp/index.html", "https://a:b@host", "https://host/path", "https://host?token=x"])
    expect(() => platformUrl(value)).toThrow();
});
