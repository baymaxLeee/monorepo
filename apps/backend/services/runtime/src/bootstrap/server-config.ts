import { getDatabaseSettings, type Environment } from "./database-config.js";

const DEV_INTERNAL_TOKEN = "dev-runtime-internal-token";

export interface Settings {
  environment: Environment;
  port: number;
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
  redisHost: string;
  redisPort: number;
  redisDb: number;
  adminServiceUrl: string;
  storageServiceUrl: string;
  knowledgeServiceUrl: string;
  workerServiceUrl: string;
  sandboxRoleUrl: string;
  canvasServiceUrl: string;
  internalApiToken: string;
  chatCallerToken: string;
  toolApprovalSecret: string;
  exaApiKey: string;
  tavilyApiKey: string;
  providerCacheTtlSeconds: number;
}

function envOr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getServerSettings(): Settings {
  const environment = envOr("ENVIRONMENT", "development");
  if (!["development", "staging", "single-vps", "production"].includes(environment)) {
    throw new Error(`unsupported ENVIRONMENT ${JSON.stringify(environment)}`);
  }
  const database = getDatabaseSettings(environment as Environment);
  const redisHost = envOr("REDIS_HOST", "localhost");
  if (environment !== "development" && ["localhost", "127.0.0.1"].includes(redisHost)) {
    throw new Error("REDIS_HOST must be set explicitly outside development");
  }
  const toolApprovalSecret = envOr("TOOL_APPROVAL_SECRET", "");
  if (environment !== "development" && (toolApprovalSecret.length < 32 || toolApprovalSecret.startsWith("dev-"))) {
    throw new Error("TOOL_APPROVAL_SECRET must be a strong secret outside development");
  }
  const internalApiToken = envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  let internalServiceTokens: unknown;
  try {
    internalServiceTokens = JSON.parse(envOr("INTERNAL_SERVICE_TOKENS", '{"chat":"dev-chat-internal-token"}'));
  } catch {
    throw new Error("INTERNAL_SERVICE_TOKENS must be a JSON object");
  }
  const chatCallerToken =
    internalServiceTokens && typeof internalServiceTokens === "object" && !Array.isArray(internalServiceTokens)
      ? (internalServiceTokens as Record<string, unknown>).chat
      : undefined;
  if (
    typeof chatCallerToken !== "string" ||
    !chatCallerToken ||
    Object.keys(internalServiceTokens as Record<string, unknown>).join() !== "chat"
  ) {
    throw new Error("INTERNAL_SERVICE_TOKENS must define exactly chat");
  }
  if (environment !== "development" && (internalApiToken.length < 32 || internalApiToken.startsWith("dev-"))) {
    throw new Error("INTERNAL_API_TOKEN must be a strong workload credential outside development");
  }
  if (environment !== "development" && (chatCallerToken.length < 32 || chatCallerToken.startsWith("dev-"))) {
    throw new Error("INTERNAL_SERVICE_TOKENS contains an invalid Chat credential");
  }
  return {
    environment: environment as Environment,
    port: envInt("PORT", 8015),
    ...database,
    redisHost,
    redisPort: envInt("REDIS_PORT", 6379),
    redisDb: envInt("REDIS_DB", 2),
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    storageServiceUrl: envOr("STORAGE_SERVICE_URL", "http://localhost:8013"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    canvasServiceUrl: envOr("CANVAS_SERVICE_URL", "http://localhost:8012"),
    workerServiceUrl: envOr("RUNTIME_WORKER_URL", "http://localhost:8011"),
    sandboxRoleUrl: envOr("RUNTIME_SANDBOX_URL", "http://localhost:8014"),
    internalApiToken,
    chatCallerToken,
    toolApprovalSecret: toolApprovalSecret || DEV_INTERNAL_TOKEN,
    exaApiKey: envOr("EXA_API_KEY", ""),
    tavilyApiKey: envOr("TAVILY_API_KEY", ""),
    providerCacheTtlSeconds: envInt("PROVIDER_CACHE_TTL_SECONDS", 300),
  };
}
