import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Settings } from "./config.js";
import { filePath, processSchema, type Scope } from "./contracts.js";

const LABEL = "monorepo.sandbox";
const HELPER = ["python3", "/opt/sandbox/runner.py"];
export function resourceName(scope: Scope): string {
  const values = [scope.tenant_id, scope.workspace_id, scope.user_id, scope.conversation_id, scope.run_id];
  return `sandbox-${createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 40)}`;
}

export async function command(
  executable: string,
  args: string[],
  input?: string,
  signal?: AbortSignal,
): Promise<string> {
  const child = spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
    signal,
    timeout: 30000,
    killSignal: "SIGKILL",
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    for (const [stream, buffer] of [
      [child.stdout, out],
      [child.stderr, err],
    ] as const) {
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_097_152) {
          child.kill("SIGKILL");
          reject(new Error("runtime control output exceeded limit"));
        } else buffer.push(chunk);
      });
    }
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out).toString())
        : reject(new Error(`runtime command failed (${code}): ${Buffer.concat(err).toString().slice(0, 1000)}`)),
    );
  });
}

export class Engine {
  constructor(
    readonly config: Settings,
    readonly execute = command,
  ) {}
  private creationTail: Promise<unknown> = Promise.resolve();
  private async admittedCreate(scope: Scope, signal?: AbortSignal) {
    const resources = await this.list();
    const existing = resources.find((resource) => resource.name === resourceName(scope));
    if (existing) {
      await this.assertOwner(existing.name, scope);
      await this.control(existing.name, { op: "health" });
      return {
        id: existing.name,
        workdir: "/workspace/work",
        expires_at: new Date(Number(existing.labels[`${LABEL}.expires`])).toISOString(),
      };
    }
    if (resources.length >= this.config.maxSandboxes) throw new Error("sandbox capacity exhausted; try a later run");
    return this.provision(scope, signal);
  }
  create(scope: Scope, signal?: AbortSignal) {
    // Docker has one controller per daemon. Serialize host admission; Kubernetes
    // additionally enforces a namespace ResourceQuota across controller replicas.
    const pending = this.creationTail.then(() => this.admittedCreate(scope, signal));
    this.creationTail = pending.catch(() => {});
    return pending;
  }
  private get executable() {
    return this.config.backend === "docker" ? "docker" : "kubectl";
  }
  private get prefix() {
    return this.config.backend === "docker" ? [] : ["--namespace", this.config.namespace];
  }
  private call(args: string[], input?: string, signal?: AbortSignal) {
    return this.execute(this.executable, [...this.prefix, ...args], input, signal);
  }
  async ready() {
    if (this.config.backend === "docker") {
      const runtimes = JSON.parse(await this.call(["info", "--format", "{{json .Runtimes}}"]));
      if (!(this.config.runtime in runtimes)) throw new Error("configured sandbox runtime unavailable");
      await this.call(["image", "inspect", this.config.image]);
      if (this.config.proxy) await this.call(["volume", "inspect", this.config.proxyVolume]);
    } else {
      await this.call(["get", "networkpolicy", "default-deny"]);
      await this.call(["get", "ciliumnetworkpolicy", "sandbox-guest-boundary"]);
      await this.list();
    }
  }
  async inspect(name: string): Promise<Record<string, string>> {
    const value =
      this.config.backend === "docker"
        ? await this.call(["inspect", "--format", "{{json .Config.Labels}}", name])
        : await this.call(["get", "pod", name, "-o", "jsonpath={.metadata.labels}"]);
    return JSON.parse(value) as Record<string, string>;
  }
  async assertOwner(id: string, scope: Scope): Promise<void> {
    if (id !== resourceName(scope)) throw new Error("sandbox scope mismatch");
    const labels = await this.inspect(id);
    if (labels[LABEL] !== "true" || labels[`${LABEL}.owner`] !== id) throw new Error("sandbox ownership mismatch");
    const expires = Number(labels[`${LABEL}.expires`]);
    if (!Number.isSafeInteger(expires) || expires <= Date.now()) throw new Error("sandbox expired or missing deadline");
  }
  private execArgs(name: string, helperArgs: string[], interactive = false): string[] {
    return this.config.backend === "docker"
      ? ["exec", ...(interactive ? ["-i"] : []), "--user", "0", name, ...HELPER, ...helperArgs]
      : ["exec", ...(interactive ? ["-i"] : []), name, "--", ...HELPER, ...helperArgs];
  }
  private async provision(scope: Scope, signal?: AbortSignal) {
    const name = resourceName(scope);
    const expires = Date.now() + this.config.ttlSeconds * 1000;
    const attempt = randomUUID();
    const labels = {
      [LABEL]: "true",
      [`${LABEL}.owner`]: name,
      [`${LABEL}.expires`]: String(expires),
      [`${LABEL}.attempt`]: attempt,
    };
    const env = {
      OUTPUT_BYTES: String(this.config.outputBytes),
      COMMAND_TIMEOUT_MS: String(this.config.commandTimeoutMs),
      MAX_COMMANDS: String(this.config.maxCommands),
      PIDS_LIMIT: String(this.config.pids),
      SANDBOX_TTL_SECONDS: String(this.config.ttlSeconds),
      ...(this.config.backend === "docker" && this.config.proxy
        ? { SANDBOX_PROXY_SOCKET: "/run/egress/proxy.sock" }
        : {}),
      ...(this.config.proxy
        ? {
            HTTP_PROXY: this.config.proxy,
            HTTPS_PROXY: this.config.proxy,
            http_proxy: this.config.proxy,
            https_proxy: this.config.proxy,
          }
        : {}),
    };
    // A run has one lazy, single-flight create in Chat. A colliding resource must
    // never be replaced or adopted following an ambiguous provisioning response.
    try {
      if (this.config.backend === "docker") {
        if (this.config.proxy) await this.call(["volume", "inspect", this.config.proxyVolume]);
        await this.call([
          "create",
          "--name",
          name,
          "--rm",
          "--pull",
          "never",
          "--runtime",
          this.config.runtime,
          "--network",
          "none",
          "--read-only",
          ...(this.config.proxy
            ? ["--mount", `type=volume,src=${this.config.proxyVolume},dst=/run/egress,readonly`]
            : []),
          "--security-opt",
          "no-new-privileges",
          "--cap-drop",
          "ALL",
          ...["SETUID", "SETGID", "CHOWN", "KILL"].flatMap((cap) => ["--cap-add", cap]),
          "--cpus",
          String(this.config.cpu),
          "--memory",
          `${this.config.memoryMiB}m`,
          "--memory-swap",
          `${this.config.memoryMiB}m`,
          "--pids-limit",
          String(this.config.pids),
          "--tmpfs",
          `/workspace:rw,nosuid,nodev,size=${this.config.diskMiB}m`,
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,size=64m",
          "--tmpfs",
          "/run/control:rw,nosuid,nodev,size=16m,mode=0700",
          ...Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
          ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
          this.config.image,
        ]);
        await this.call(["start", name]);
      } else {
        await this.call(["create", "-f", "-"], JSON.stringify(this.pod(name, labels, env)));
        await this.call(["wait", "--for=condition=Ready", `pod/${name}`, "--timeout=25s"]);
      }
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        try {
          await this.control(name, { op: "health" });
          break;
        } catch (error) {
          if (attempt >= 20) throw error;
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
        }
      }
      return { id: name, workdir: "/workspace/work", expires_at: new Date(expires).toISOString() };
    } catch (error) {
      const current = await this.inspect(name).catch(() => null);
      if (current?.[`${LABEL}.attempt`] === attempt) await this.remove(name).catch(() => {});
      throw error;
    }
  }
  pod(name: string, labels: Record<string, string>, env: Record<string, string>) {
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name, namespace: this.config.namespace, labels },
      spec: {
        runtimeClassName: this.config.runtime,
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        restartPolicy: "Never",
        activeDeadlineSeconds: this.config.ttlSeconds,
        terminationGracePeriodSeconds: 5,
        securityContext: { seccompProfile: { type: "RuntimeDefault" } },
        containers: [
          {
            name: "runtime",
            image: this.config.image,
            env: Object.entries(env).map(([name, value]) => ({ name, value })),
            securityContext: {
              runAsUser: 0,
              allowPrivilegeEscalation: false,
              readOnlyRootFilesystem: true,
              capabilities: { drop: ["ALL"], add: ["SETUID", "SETGID", "CHOWN", "KILL"] },
              seccompProfile: { type: "RuntimeDefault" },
            },
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: {
                cpu: String(this.config.cpu),
                memory: `${this.config.memoryMiB}Mi`,
                "ephemeral-storage": `${this.config.diskMiB + 128}Mi`,
              },
            },
            volumeMounts: [
              { name: "work", mountPath: "/workspace" },
              { name: "tmp", mountPath: "/tmp" },
              { name: "control", mountPath: "/run/control" },
            ],
          },
        ],
        volumes: [
          { name: "work", emptyDir: { sizeLimit: `${this.config.diskMiB}Mi` } },
          { name: "tmp", emptyDir: { medium: "Memory", sizeLimit: "64Mi" } },
          { name: "control", emptyDir: { medium: "Memory", sizeLimit: "16Mi" } },
        ],
      },
    };
  }
  async control(name: string, input: object) {
    const raw = await this.call(this.execArgs(name, ["request"], true), JSON.stringify(input));
    const value = JSON.parse(raw) as { error?: string; result?: unknown };
    if (value.error || !value.result) throw new Error(value.error ?? "missing runner response");
    return value.result;
  }
  async process(id: string, scope: Scope, input: object) {
    await this.assertOwner(id, scope);
    const result = processSchema.parse(await this.control(id, input));
    // Container teardown also terminates descendants that escaped their shell's
    // process group. A timed-out workspace is not reused by subsequent calls.
    if (result.timed_out) await this.remove(id);
    return result;
  }
  async remove(name: string) {
    try {
      await this.call(
        this.config.backend === "docker"
          ? ["rm", "--force", name]
          : ["delete", "pod", name, "--ignore-not-found", "--wait=false"],
      );
    } catch (error) {
      if (!(error instanceof Error && /No such (container|object)/i.test(error.message))) throw error;
    }
  }
  async destroy(id: string, scope: Scope) {
    if (id !== resourceName(scope)) throw new Error("sandbox scope mismatch");
    // Delete by the unforgeable scoped name; succeeds even when initialization
    // never completed. The manager namespace is dedicated to these resources.
    const resources = await this.list();
    if (resources.some((r) => r.name === id && r.labels[`${LABEL}.owner`] === id)) await this.remove(id);
  }
  async list(): Promise<Array<{ name: string; labels: Record<string, string> }>> {
    if (this.config.backend === "docker") {
      const names = (await this.call(["ps", "-a", "--filter", `label=${LABEL}=true`, "--format", "{{.Names}}"]))
        .trim()
        .split("\n")
        .filter(Boolean);
      const rows = await Promise.all(
        names.map(async (name) => {
          try {
            return { name, labels: await this.inspect(name) };
          } catch (error) {
            if (error instanceof Error && /No such (container|object)/i.test(error.message)) return null;
            throw error;
          }
        }),
      );
      return rows.filter((row) => row !== null);
    }
    const raw = JSON.parse(await this.call(["get", "pods", "-l", `${LABEL}=true`, "-o", "json"])) as {
      items: Array<{ metadata: { name: string; labels: Record<string, string> } }>;
    };
    return raw.items.map(({ metadata }) => metadata);
  }
  async reap() {
    const expired = (await this.list()).filter((r) => Number(r.labels[`${LABEL}.expires`]) <= Date.now());
    const results = await Promise.allSettled(expired.map((r) => this.remove(r.name)));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  async upload(id: string, scope: Scope, path: string, body: ReadableStream<Uint8Array>, signal: AbortSignal) {
    await this.assertOwner(id, scope);
    filePath(path);
    if (!path.startsWith("sources/")) throw new Error("imports must be under sources/");
    const child = spawn(
      this.executable,
      [...this.prefix, ...this.execArgs(id, ["write", path, String(this.config.maxTransferBytes)], true)],
      { stdio: ["pipe", "ignore", "pipe"], signal },
    );
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-2000);
    });
    const completion = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || "file import failed"))));
    });
    let bytes = 0;
    const limit = this.config.maxTransferBytes;
    const transfer = pipeline(
      Readable.fromWeb(body as never),
      async function* (source) {
        for await (const chunk of source) {
          bytes += chunk.length;
          if (bytes > limit) throw new Error("file exceeds transfer limit");
          for (let offset = 0; offset < chunk.length; offset += 65536) {
            const part = chunk.subarray(offset, offset + 65536);
            const length = Buffer.alloc(4);
            length.writeUInt32BE(part.length);
            yield length;
            yield part;
          }
        }
        // An explicit end frame commits the file. EOF after a broken HTTP stream
        // never commits a partial source snapshot.
        yield Buffer.alloc(4);
      },
      child.stdin,
      { signal },
    );
    try {
      await Promise.all([completion, transfer]);
    } catch (error) {
      child.kill("SIGKILL");
      await Promise.allSettled([completion, transfer]);
      throw error;
    }
  }
  async download(id: string, scope: Scope, path: string, signal: AbortSignal) {
    await this.assertOwner(id, scope);
    filePath(path);
    const info = JSON.parse(
      await this.call(this.execArgs(id, ["stat", path, String(this.config.maxTransferBytes)])),
    ) as { size: number };
    const child = spawn(
      this.executable,
      [...this.prefix, ...this.execArgs(id, ["read", path, String(this.config.maxTransferBytes)])],
      { stdio: ["ignore", "pipe", "pipe"], signal },
    );
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-2000);
    });
    const completion = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || "file export failed"))));
    });
    // Observe rejection immediately, but do not report EOF until the helper has
    // confirmed the entire transfer. Truncated artifacts must never be published.
    void completion.catch(() => {});
    const stream = Readable.from(
      (async function* () {
        try {
          yield* child.stdout;
          await completion;
        } finally {
          child.kill("SIGKILL");
          await completion.catch(() => {});
        }
      })(),
    );
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size: info.size };
  }
}
