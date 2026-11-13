import { createHash } from "node:crypto";

import { net } from "electron";
import { z } from "zod";

const userSchema = z
  .object({
    id: z.string(),
    activeWorkspace: z
      .object({ tenantId: z.string(), workspaceId: z.string(), status: z.string() })
      .passthrough()
      .nullable(),
  })
  .passthrough();
const sessionSchema = z
  .object({ accessToken: z.string().min(1), expiresAt: z.iso.datetime({ offset: true }), user: userSchema })
  .passthrough();
export class DesktopAuth {
  private token: string | null = null;
  private expires = 0;
  private scope: string | null = null;
  private generation = 0;
  private changes: Promise<void> = Promise.resolve();
  private refreshPromise: Promise<z.infer<typeof sessionSchema>> | null = null;
  constructor(
    readonly origin: string,
    private readonly onScope: (scope: string | null) => Promise<void>,
  ) {}
  identity() {
    return this.scope;
  }
  private change(scope: string | null, generation: number) {
    const operation = this.changes
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation) throw new Error("登录身份已改变");
        if (this.scope !== scope) {
          await this.onScope(scope);
          this.scope = scope;
        }
      });
    this.changes = operation;
    return operation;
  }
  private async accept(token: string, expires: string, user: z.infer<typeof userSchema>, generation: number) {
    if (generation !== this.generation) throw new Error("登录身份已改变");
    const scope =
      user.activeWorkspace?.status === "active"
        ? createHash("sha256")
            .update(
              JSON.stringify([this.origin, user.id, user.activeWorkspace.tenantId, user.activeWorkspace.workspaceId]),
            )
            .digest("hex")
        : null;
    await this.change(scope, generation);
    if (generation !== this.generation) throw new Error("登录身份已改变");
    this.token = token;
    this.expires = Date.parse(expires);
  }
  async bind(token: string, expires: string) {
    const generation = ++this.generation;
    const response = await net.fetch(`${this.origin}/api/iam-server/me`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (generation === this.generation) await this.clear();
      throw new Error("桌面登录身份验证失败，请重新登录");
    }
    await this.accept(token, expires, userSchema.parse(await response.json()), generation);
  }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    const operation = (async () => {
      const response = await net.fetch(`${this.origin}/api/iam-server/refresh`, {
        method: "POST",
        credentials: "include",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("登录已过期，请重新登录");
      const session = sessionSchema.parse(await response.json());
      await this.accept(session.accessToken, session.expiresAt, session.user, generation);
      return session;
    })();
    this.refreshPromise = operation;
    void operation
      .finally(() => {
        if (this.refreshPromise === operation) this.refreshPromise = null;
      })
      .catch(() => undefined);
    return operation;
  }
  async clear() {
    const generation = ++this.generation;
    this.token = null;
    this.expires = 0;
    this.refreshPromise = null;
    await this.change(null, generation);
  }
  async fetch(path: string, init?: RequestInit) {
    if (!/^\/api\/chat-server\/local-inference\/(config(?:\?agent_id=[^&]*)?|stream)$/.test(path))
      throw new Error("未授权的模型地址");
    if (!this.token || !this.scope) throw new Error("请先登录并选择工作区");
    const scope = this.scope;
    if (this.expires < Date.now() + 30_000) await this.refresh();
    if (this.scope !== scope || !this.token) throw new Error("登录身份已改变");
    init?.signal?.throwIfAborted();
    const response = await net.fetch(`${this.origin}${path}`, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(init?.signal ? [init.signal] : [])]),
      headers: { ...Object.fromEntries(new Headers(init?.headers)), Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(problem.message ?? `模型服务返回 ${response.status}`);
    }
    return response;
  }
}
