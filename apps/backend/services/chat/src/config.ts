export type Environment = "development" | "staging" | "single-vps" | "production";

const DEV_INTERNAL_TOKEN = "dev-internal-token";

export interface Settings {
  environment: Environment;
  port: number;
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlDatabase: string;
  redisHost: string;
  redisPort: number;
  redisDb: number;
  adminServiceUrl: string;
  knowledgeServiceUrl: string;
  internalApiToken: string;
  agentToolApprovalSecret: string;
  tavilyApiKey: string;
  providerCacheTtlSeconds: number;
  // Workflow DevKit "World" (durable run/step state). Unset locally → Local
  // World (.workflow-data/). Set in deploy to point at self-hosted Postgres.
  workflowDatabaseUrl: string;
  workflowTargetWorld: string;
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
  return {
    environment: envOr("ENVIRONMENT", "development") as Environment,
    port: envInt("PORT", 8009),
    mysqlHost: envOr("MYSQL_HOST", "localhost"),
    mysqlPort: envInt("MYSQL_PORT", 3306),
    mysqlUser: envOr("MYSQL_USER", "dev"),
    mysqlPassword: envOr("MYSQL_PASSWORD", "dev"),
    mysqlDatabase: envOr("MYSQL_DATABASE", "chat"),
    redisHost: envOr("REDIS_HOST", "localhost"),
    redisPort: envInt("REDIS_PORT", 6379),
    redisDb: envInt("REDIS_DB", 2),
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    internalApiToken: envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN),
    agentToolApprovalSecret: envOr("AGENT_TOOL_APPROVAL_SECRET", envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN)),
    tavilyApiKey: envOr("TAVILY_API_KEY", ""),
    providerCacheTtlSeconds: envInt("PROVIDER_CACHE_TTL_SECONDS", 300),
    workflowDatabaseUrl: envOr("DATABASE_URL", ""),
    workflowTargetWorld: envOr("WORKFLOW_TARGET_WORLD", ""),
  };
}

export function mysqlUrl(settings: Settings = getSettings()): string {
  const enc = encodeURIComponent;
  return `mysql://${enc(settings.mysqlUser)}:${enc(settings.mysqlPassword)}@${settings.mysqlHost}:${settings.mysqlPort}/${settings.mysqlDatabase}`;
}

export function redisUrl(settings: Settings = getSettings()): string {
  const s = settings;
  return `redis://${s.redisHost}:${s.redisPort}/${s.redisDb}`;
}
