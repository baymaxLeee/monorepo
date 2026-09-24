export type Environment = "development" | "staging" | "single-vps" | "production";

const DEV_INTERNAL_TOKEN = "dev-chat-internal-token";

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
  assetServiceUrl: string;
  knowledgeServiceUrl: string;
  executorServiceUrl: string;
  canvasServiceUrl: string;
  internalApiToken: string;
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

export function getSettings(): Settings {
  const environment = envOr("ENVIRONMENT", "development");
  if (!["development", "staging", "single-vps", "production"].includes(environment)) {
    throw new Error(`unsupported ENVIRONMENT ${JSON.stringify(environment)}`);
  }
  const postgresPassword = envOr("POSTGRES_PASSWORD", "chat");
  const postgresHost = envOr("POSTGRES_HOST", "localhost");
  const redisHost = envOr("REDIS_HOST", "localhost");
  if (environment !== "development" && (!postgresPassword || postgresPassword === "chat")) {
    throw new Error("POSTGRES_PASSWORD must be set explicitly outside development");
  }
  if (environment !== "development" && ["localhost", "127.0.0.1"].includes(postgresHost)) {
    throw new Error("POSTGRES_HOST must be set explicitly outside development");
  }
  if (environment !== "development" && ["localhost", "127.0.0.1"].includes(redisHost)) {
    throw new Error("REDIS_HOST must be set explicitly outside development");
  }
  const toolApprovalSecret = envOr("TOOL_APPROVAL_SECRET", "");
  if (environment !== "development" && (toolApprovalSecret.length < 32 || toolApprovalSecret.startsWith("dev-"))) {
    throw new Error("TOOL_APPROVAL_SECRET must be a strong secret outside development");
  }
  const internalApiToken = envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  if (environment !== "development" && (internalApiToken.length < 32 || internalApiToken.startsWith("dev-"))) {
    throw new Error("INTERNAL_API_TOKEN must be a strong workload credential outside development");
  }
  return {
    environment: environment as Environment,
    port: envInt("PORT", 8009),
    postgresHost,
    postgresPort: envInt("POSTGRES_PORT", 5432),
    postgresUser: envOr("POSTGRES_USER", "chat"),
    postgresPassword,
    postgresDatabase: envOr("POSTGRES_DATABASE", "chat"),
    redisHost,
    redisPort: envInt("REDIS_PORT", 6379),
    redisDb: envInt("REDIS_DB", 2),
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    assetServiceUrl: envOr("ASSET_SERVICE_URL", "http://localhost:8013"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    canvasServiceUrl: envOr("CANVAS_SERVICE_URL", "http://localhost:8012"),
    executorServiceUrl: envOr("EXECUTOR_SERVICE_URL", "http://localhost:8011"),
    internalApiToken,
    toolApprovalSecret: toolApprovalSecret || DEV_INTERNAL_TOKEN,
    exaApiKey: envOr("EXA_API_KEY", ""),
    tavilyApiKey: envOr("TAVILY_API_KEY", ""),
    providerCacheTtlSeconds: envInt("PROVIDER_CACHE_TTL_SECONDS", 300),
  };
}
