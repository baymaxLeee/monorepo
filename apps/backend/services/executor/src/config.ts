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
  internalApiToken: string;
  adminServiceUrl: string;
  knowledgeServiceUrl: string;
  chatServiceUrl: string;
  ffmpegPath: string;
  htmlBlockConcurrency: number;
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

function envIntClamped(key: string, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(envInt(key, fallback), max));
}

export function getSettings(): Settings {
  const environment = envOr("ENVIRONMENT", "development") as Environment;
  const internalApiToken = envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  const postgresPassword = envOr("POSTGRES_PASSWORD", "executor");
  if (environment === "production" && internalApiToken === DEV_INTERNAL_TOKEN) {
    throw new Error("INTERNAL_API_TOKEN must be set explicitly in production");
  }
  if (environment === "production" && (!postgresPassword || postgresPassword === "executor")) {
    throw new Error("POSTGRES_PASSWORD must be set explicitly in production");
  }
  return {
    environment,
    port: envInt("PORT", 8011),
    postgresHost: envOr("POSTGRES_HOST", "localhost"),
    postgresPort: envInt("POSTGRES_PORT", 5432),
    postgresUser: envOr("POSTGRES_USER", "executor"),
    postgresPassword,
    postgresDatabase: envOr("POSTGRES_DATABASE", "executor"),
    internalApiToken,
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    chatServiceUrl: envOr("CHAT_SERVICE_URL", "http://localhost:8009"),
    ffmpegPath: envOr("FFMPEG_PATH", "ffmpeg"),
    // Bounded above by WORKFLOW_POSTGRES_WORKER_CONCURRENCY (the WDK step pool)
    // and the provider's rate limit; transient 429/5xx are absorbed by retries.
    htmlBlockConcurrency: envIntClamped("HTML_BLOCK_CONCURRENCY", 8, 1, 32),
  };
}
