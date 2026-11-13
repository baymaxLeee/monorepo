import type { AuthSession } from "@repo/api/iam";
import { afterEach, expect, it, vi } from "vitest";

// Federation bundles API clients per app while sharing the runtime binding.
const runtime = await import("@repo/runtime");
vi.doMock("@repo/runtime", () => runtime);
vi.mock("@repo/observability", () => ({ attachAxios: vi.fn() }));

const session: AuthSession = {
  accessToken: "host-token",
  expiresAt: "2099-01-01T00:00:00Z",
  user: {
    id: "user",
    account: "user",
    email: "",
    displayName: "User",
    avatarUrl: "",
    locale: "zh",
    timezone: "UTC",
    theme: "system",
    marketingOptIn: false,
    emailVerified: false,
    roles: [],
    memberships: [],
    activeWorkspace: null,
  },
};

let clearHost: (() => void) | undefined;

async function host() {
  vi.resetModules();
  const auth = await import("./session");
  clearHost = (await import("./storage")).clearSession;
  const api = await import("@repo/api");
  const adapter = vi.fn(async (config) => ({ data: session, status: 200, statusText: "OK", headers: {}, config }));
  api.apiHttp.defaults.adapter = adapter;
  return { auth, api, adapter };
}

afterEach(() => {
  clearHost?.();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("commits login in Platform and authenticates separately bundled generated clients", async () => {
  const app = await host();
  await app.auth.login({ account: "user", password: "password" });
  vi.resetModules();
  const remote = await import("@repo/api");
  const client = await import("@repo/api/chat");
  let authorization: unknown;
  remote.apiHttp.defaults.adapter = async (config) => {
    authorization = config.headers.Authorization;
    return { data: [], status: 200, statusText: "OK", headers: {}, config };
  };
  await client.listConversations();
  expect(authorization).toBe("Bearer host-token");
  expect(app.adapter).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("platform.access_token")).toBeNull();
  await runtime.getPlatformAuth()!.logout();
  expect(runtime.getPlatformAuth()!.getAccessToken()).toBeNull();
});

it("coalesces host and remote refresh and clears credentials on refresh rejection", async () => {
  const app = await host();
  const result = await Promise.all([app.auth.refreshSession(), runtime.getPlatformAuth()!.refreshAccessToken()]);
  expect(result).toEqual([session, true]);
  expect(app.adapter).toHaveBeenCalledTimes(1);
  app.api.apiHttp.defaults.adapter = async () => {
    throw new Error("rejected");
  };
  expect(await app.auth.refreshSession()).toBeNull();
  expect(runtime.getPlatformAuth()!.getAccessToken()).toBeNull();
});

it("commits registration and workspace rotation through Platform actions", async () => {
  const app = await host();
  await app.auth.register({ account: "user", password: "password", displayName: "User", email: "user@example.test" });
  app.api.apiHttp.defaults.adapter = async (config) => ({
    data: { ...session, accessToken: "workspace-token" },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  });
  await runtime.getPlatformAuth()!.switchWorkspace("workspace");
  expect(runtime.getPlatformAuth()!.getAccessToken()).toBe("workspace-token");
});

it("clears host credentials even when the logout request fails", async () => {
  const app = await host();
  await app.auth.login({ account: "user", password: "password" });
  app.api.apiHttp.defaults.adapter = async () => {
    throw new Error("offline");
  };
  await expect(runtime.getPlatformAuth()!.logout()).rejects.toThrow("offline");
  expect(runtime.getPlatformAuth()!.getAccessToken()).toBeNull();
});

it("refreshes generated-only clients and streaming requests through Platform", async () => {
  const app = await host();
  clearHost?.();
  vi.resetModules();
  const remote = await import("@repo/api");
  let authorization: unknown;
  remote.apiHttp.defaults.adapter = async (config) => {
    authorization = config.headers.Authorization;
    return { data: [], status: 200, statusText: "OK", headers: {}, config };
  };
  await remote.request({ url: "/api/chat-server/conversations" });
  expect(authorization).toBe("Bearer host-token");
  expect(app.adapter).toHaveBeenCalledTimes(1);

  app.api.apiHttp.defaults.adapter = async (config) => ({
    data: { ...session, accessToken: "refreshed-token" },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  });
  const tokens: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      tokens.push(new Headers(init.headers).get("Authorization"));
      return new Response(null, { status: tokens.length === 1 ? 401 : 200 });
    }),
  );
  expect((await remote.authFetch("/api/chat-server/stream")).status).toBe(200);
  expect(tokens).toEqual(["Bearer host-token", "Bearer refreshed-token"]);
});
