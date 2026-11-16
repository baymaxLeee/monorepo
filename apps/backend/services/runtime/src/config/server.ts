import { parseDatabaseSettings } from "./database.js";
import { envOr, nonNegativeInt, parseEnvironment, positiveInt, type Environment } from "./env.js";

const DEV_INTERNAL_TOKEN = "dev-runtime-internal-token";

export interface ServerSettings {
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

export function parseServerSettings(env: NodeJS.ProcessEnv): ServerSettings {
  const environment = parseEnvironment(env);
  const database = parseDatabaseSettings(environment, env);
  const redisHost = envOr(env, "REDIS_HOST", "localhost");
  if (environment !== "development" && ["localhost", "127.0.0.1"].includes(redisHost)) {
    throw new Error("REDIS_HOST must be set explicitly outside development");
  }
  const toolApprovalSecret = envOr(env, "TOOL_APPROVAL_SECRET", "");
  if (environment !== "development" && (toolApprovalSecret.length < 32 || toolApprovalSecret.startsWith("dev-"))) {
    throw new Error("TOOL_APPROVAL_SECRET must be a strong secret outside development");
  }
  const internalApiToken = envOr(env, "INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  let internalServiceTokens: unknown;
  try {
    internalServiceTokens = JSON.parse(envOr(env, "INTERNAL_SERVICE_TOKENS", '{"chat":"dev-chat-internal-token"}'));
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
    environment,
    port: positiveInt(env, "PORT", 8015),
    ...database,
    redisHost,
    redisPort: positiveInt(env, "REDIS_PORT", 6379),
    redisDb: nonNegativeInt(env, "REDIS_DB", 2),
    adminServiceUrl: envOr(env, "ADMIN_SERVICE_URL", "http://localhost:8001"),
    storageServiceUrl: envOr(env, "STORAGE_SERVICE_URL", "http://localhost:8013"),
    knowledgeServiceUrl: envOr(env, "KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    canvasServiceUrl: envOr(env, "CANVAS_SERVICE_URL", "http://localhost:8012"),
    workerServiceUrl: envOr(env, "RUNTIME_WORKER_URL", "http://localhost:8011"),
    sandboxRoleUrl: envOr(env, "RUNTIME_SANDBOX_URL", "http://localhost:8014"),
    internalApiToken,
    chatCallerToken,
    toolApprovalSecret: toolApprovalSecret || DEV_INTERNAL_TOKEN,
    exaApiKey: envOr(env, "EXA_API_KEY", ""),
    tavilyApiKey: envOr(env, "TAVILY_API_KEY", ""),
    providerCacheTtlSeconds: positiveInt(env, "PROVIDER_CACHE_TTL_SECONDS", 300),
  };
}

let cached: ServerSettings | undefined;

export function getServerSettings(): ServerSettings {
  cached ??= parseServerSettings(process.env);
  return cached;
}
