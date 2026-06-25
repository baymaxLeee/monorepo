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
  llmTimeoutSeconds: number;
  llmMaxOutputTokens: number;
  agentMaxTurns: number;
  agentRunTimeoutSeconds: number;
  agentContextRecentMessages: number;
  agentContextMessageMaxChars: number;
  agentArtifactMaxChars: number;
  agentArtifactTotalMaxChars: number;
  agentEventStreamTtlSeconds: number;
  agentEventStreamBlockMs: number;
  agentEventStreamStaleSeconds: number;
  agentToolTimeoutSeconds: number;
  agentContextMaxChars: number;
  agentMemoryMaxItems: number;
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
    llmTimeoutSeconds: envInt("LLM_TIMEOUT_SECONDS", 60),
    llmMaxOutputTokens: envInt("LLM_MAX_OUTPUT_TOKENS", 4096),
    agentMaxTurns: envInt("AGENT_MAX_TURNS", 20),
    agentRunTimeoutSeconds: envInt("AGENT_RUN_TIMEOUT_SECONDS", 3600),
    agentContextRecentMessages: envInt("AGENT_CONTEXT_RECENT_MESSAGES", 10),
    agentContextMessageMaxChars: envInt("AGENT_CONTEXT_MESSAGE_MAX_CHARS", 1000),
    agentArtifactMaxChars: envInt("AGENT_ARTIFACT_MAX_CHARS", 20000),
    agentArtifactTotalMaxChars: envInt("AGENT_ARTIFACT_TOTAL_MAX_CHARS", 40000),
    agentEventStreamTtlSeconds: envInt("AGENT_EVENT_STREAM_TTL_SECONDS", 7200),
    agentEventStreamBlockMs: envInt("AGENT_EVENT_STREAM_BLOCK_MS", 100),
    agentEventStreamStaleSeconds: envInt("AGENT_EVENT_STREAM_STALE_SECONDS", 15),
    agentToolTimeoutSeconds: envInt("AGENT_TOOL_TIMEOUT_SECONDS", 30),
    agentContextMaxChars: envInt("AGENT_CONTEXT_MAX_CHARS", 24000),
    agentMemoryMaxItems: envInt("AGENT_MEMORY_MAX_ITEMS", 12),
    tavilyApiKey: envOr("TAVILY_API_KEY", ""),
    providerCacheTtlSeconds: envInt("PROVIDER_CACHE_TTL_SECONDS", 300),
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
