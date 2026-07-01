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
  internalApiToken: string;
  adminServiceUrl: string;
  knowledgeServiceUrl: string;
  chatServiceUrl: string;
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
  const internalApiToken = envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  // Demo-phase guardrail (see chat-server AGENTS.md P2 finding): never let a
  // production deployment silently fall back to the well-known dev token.
  if (environment === "production" && internalApiToken === DEV_INTERNAL_TOKEN) {
    throw new Error("INTERNAL_API_TOKEN must be set explicitly in production");
  }
  return {
    environment,
    port: envInt("PORT", 8011),
    mysqlHost: envOr("MYSQL_HOST", "localhost"),
    mysqlPort: envInt("MYSQL_PORT", 3306),
    mysqlUser: envOr("MYSQL_USER", "dev"),
    mysqlPassword: envOr("MYSQL_PASSWORD", "dev"),
    mysqlDatabase: envOr("MYSQL_DATABASE", "executor"),
    internalApiToken,
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    // Outbound task-event notifications (progress + terminal) are pushed to the
    // owning service. Only chat is an owner today; this is the reverse of chat's
    // EXECUTOR_SERVICE_URL and lets executor reach chat's /internal endpoints
    // directly (not via the gateway), authed by the shared internal token.
    chatServiceUrl: envOr("CHAT_SERVICE_URL", "http://localhost:8009"),
  };
}
