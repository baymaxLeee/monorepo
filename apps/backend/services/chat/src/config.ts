export type Environment = "development" | "staging" | "single-vps" | "production";

const DEV_INTERNAL_TOKEN = "dev-internal-token";

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
  knowledgeServiceUrl: string;
  executorServiceUrl: string;
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
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getSettings(): Settings {
  const environment = envOr("ENVIRONMENT", "development") as Environment;
  const postgresPassword = envOr("POSTGRES_PASSWORD", "chat");
  if (environment === "production" && (!postgresPassword || postgresPassword === "chat")) {
    throw new Error("POSTGRES_PASSWORD must be set explicitly in production");
  }
  const toolApprovalSecret = envOr("TOOL_APPROVAL_SECRET", "");
  if (environment === "production" && !toolApprovalSecret) {
    throw new Error("TOOL_APPROVAL_SECRET must be set explicitly in production");
  }
  const internalApiToken = envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  if (environment === "production" && internalApiToken === DEV_INTERNAL_TOKEN) {
    throw new Error("INTERNAL_API_TOKEN must be set explicitly in production");
  }
  return {
    environment,
    port: envInt("PORT", 8009),
    postgresHost: envOr("POSTGRES_HOST", "localhost"),
    postgresPort: envInt("POSTGRES_PORT", 5432),
    postgresUser: envOr("POSTGRES_USER", "chat"),
    postgresPassword,
    postgresDatabase: envOr("POSTGRES_DATABASE", "chat"),
    redisHost: envOr("REDIS_HOST", "localhost"),
    redisPort: envInt("REDIS_PORT", 6379),
    redisDb: envInt("REDIS_DB", 2),
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    executorServiceUrl: envOr("EXECUTOR_SERVICE_URL", "http://localhost:8011"),
    internalApiToken,
    toolApprovalSecret: toolApprovalSecret || DEV_INTERNAL_TOKEN,
    exaApiKey: envOr("EXA_API_KEY", ""),
    tavilyApiKey: envOr("TAVILY_API_KEY", ""),
    providerCacheTtlSeconds: envInt("PROVIDER_CACHE_TTL_SECONDS", 300),
  };
}

export function postgresUrl(settings: Settings = getSettings()): string {
  const enc = encodeURIComponent;
  return `postgresql://${enc(settings.postgresUser)}:${enc(settings.postgresPassword)}@${settings.postgresHost}:${settings.postgresPort}/${settings.postgresDatabase}`;
}

export function redisUrl(settings: Settings = getSettings()): string {
  const s = settings;
  return `redis://${s.redisHost}:${s.redisPort}/${s.redisDb}`;
}
