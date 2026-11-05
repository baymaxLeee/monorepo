export interface Settings {
  port: number;
  backend: "docker" | "kubernetes";
  chatToken: string;
  image: string;
  runtime: string;
  namespace: string;
  proxyVolume: string;
  proxy: string;
  cpu: number;
  memoryMiB: number;
  diskMiB: number;
  pids: number;
  ttlSeconds: number;
  maxTransferBytes: number;
  outputBytes: number;
  commandTimeoutMs: number;
  maxCommands: number;
  maxSandboxes: number;
  maxRequests: number;
}

export function settings(env: NodeJS.ProcessEnv = process.env): Settings {
  if (env.ENVIRONMENT && !["development", "staging", "single-vps", "production"].includes(env.ENVIRONMENT))
    throw new Error("unsupported ENVIRONMENT");
  const positive = (name: string, fallback: number) => {
    const n = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
    return n;
  };
  const backend = env.SANDBOX_BACKEND ?? "docker";
  if (backend !== "docker" && backend !== "kubernetes") throw new Error("invalid SANDBOX_BACKEND");
  const tokens = JSON.parse(env.INTERNAL_SERVICE_TOKENS ?? '{"chat":"dev-chat-internal-token"}') as Record<
    string,
    unknown
  >;
  const chatToken = tokens.chat;
  if (typeof chatToken !== "string" || !chatToken || Object.keys(tokens).join() !== "chat") {
    throw new Error("INTERNAL_SERVICE_TOKENS must contain only the Chat credential");
  }
  if (env.ENVIRONMENT !== "development" && (chatToken.length < 32 || chatToken.startsWith("dev-")))
    throw new Error("strong Chat credential required");
  const runtime = env.SANDBOX_RUNTIME ?? "runsc";
  if (runtime !== "runsc" && env.ENVIRONMENT !== "development") throw new Error("production sandboxes require runsc");
  const proxy = env.SANDBOX_PROXY_URL ?? "";
  if (proxy && !/^http:\/\/[^/@\s]+:\d+$/.test(proxy)) throw new Error("invalid SANDBOX_PROXY_URL");
  if (backend === "docker" && proxy && proxy !== "http://127.0.0.1:3128")
    throw new Error("Docker egress must use the isolated Unix socket proxy");
  return {
    port: positive("PORT", 8014),
    backend,
    chatToken,
    image: env.SANDBOX_IMAGE ?? "local/sandbox-runtime:latest",
    runtime,
    namespace: env.SANDBOX_NAMESPACE ?? "monorepo-sandboxes",
    proxyVolume: env.SANDBOX_PROXY_VOLUME ?? "monorepo-sandbox-egress",
    proxy,
    cpu: positive("SANDBOX_CPUS", 1),
    memoryMiB: positive("SANDBOX_MEMORY_MIB", 512),
    diskMiB: positive("SANDBOX_DISK_MIB", 512),
    pids: positive("SANDBOX_PIDS", 128),
    ttlSeconds: positive("SANDBOX_TTL_SECONDS", 1800),
    maxTransferBytes: positive("SANDBOX_MAX_TRANSFER_BYTES", 104857600),
    outputBytes: positive("SANDBOX_OUTPUT_BYTES", 65536),
    commandTimeoutMs: positive("SANDBOX_COMMAND_TIMEOUT_MS", 1800000),
    maxCommands: positive("SANDBOX_MAX_COMMANDS", 64),
    maxSandboxes: positive("SANDBOX_MAX_SANDBOXES", 16),
    maxRequests: positive("SANDBOX_MAX_REQUESTS", 64),
  };
}
