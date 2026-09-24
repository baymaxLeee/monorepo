export type Environment = "development" | "staging" | "single-vps" | "production";

const DEV_INTERNAL_TOKEN = "dev-executor-internal-token";

export interface Settings {
  environment: Environment;
  port: number;
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
  internalApiToken: string;
  internalServiceTokens: Readonly<Record<string, string>>;
  adminServiceUrl: string;
  assetServiceUrl: string;
  knowledgeServiceUrl: string;
  canvasServiceUrl: string;
  ffmpegPath: string;
  fileTaskConcurrency: number;
  videoSegmentConcurrency: number;
}

const DEV_INTERNAL_SERVICE_TOKENS = {
  canvas: "dev-canvas-internal-token",
  chat: "dev-chat-internal-token",
  knowledge: "dev-knowledge-internal-token",
} as const;

function internalServiceTokens(environment: Environment): Readonly<Record<string, string>> {
  const raw = envOr("INTERNAL_SERVICE_TOKENS", JSON.stringify(DEV_INTERNAL_SERVICE_TOKENS));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INTERNAL_SERVICE_TOKENS must be a JSON object");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("INTERNAL_SERVICE_TOKENS must be a JSON object");
  }
  const tokens = parsed as Record<string, unknown>;
  if (Object.keys(tokens).sort().join(",") !== "canvas,chat,knowledge") {
    throw new Error("INTERNAL_SERVICE_TOKENS must define exactly canvas, chat, and knowledge");
  }
  for (const token of Object.values(tokens)) {
    if (
      typeof token !== "string" ||
      (environment !== "development" && (token.length < 32 || token.startsWith("dev-")))
    ) {
      throw new Error("INTERNAL_SERVICE_TOKENS contains an invalid credential");
    }
  }
  if (new Set(Object.values(tokens)).size !== Object.keys(tokens).length) {
    throw new Error("INTERNAL_SERVICE_TOKENS credentials must be unique");
  }
  return tokens as Record<string, string>;
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

function envIntClamped(key: string, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(envInt(key, fallback), max));
}

export function getSettings(): Settings {
  const environment = envOr("ENVIRONMENT", "development");
  if (!["development", "staging", "single-vps", "production"].includes(environment)) {
    throw new Error(`unsupported ENVIRONMENT ${JSON.stringify(environment)}`);
  }
  const internalApiToken = envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  const postgresPassword = envOr("POSTGRES_PASSWORD", "executor");
  const postgresHost = envOr("POSTGRES_HOST", "localhost");
  if (environment !== "development" && (internalApiToken.length < 32 || internalApiToken.startsWith("dev-"))) {
    throw new Error("INTERNAL_API_TOKEN must be a strong workload credential outside development");
  }
  if (environment !== "development" && (!postgresPassword || postgresPassword === "executor")) {
    throw new Error("POSTGRES_PASSWORD must be set explicitly outside development");
  }
  if (environment !== "development" && ["localhost", "127.0.0.1"].includes(postgresHost)) {
    throw new Error("POSTGRES_HOST must be set explicitly outside development");
  }
  return {
    environment: environment as Environment,
    port: envInt("PORT", 8011),
    postgresHost,
    postgresPort: envInt("POSTGRES_PORT", 5432),
    postgresUser: envOr("POSTGRES_USER", "executor"),
    postgresPassword,
    postgresDatabase: envOr("POSTGRES_DATABASE", "executor"),
    internalApiToken,
    internalServiceTokens: internalServiceTokens(environment as Environment),
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    assetServiceUrl: envOr("ASSET_SERVICE_URL", "http://localhost:8013"),
    canvasServiceUrl: envOr("CANVAS_SERVICE_URL", "http://localhost:8012"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    ffmpegPath: envOr("FFMPEG_PATH", "ffmpeg"),
    // Bounded above by WORKFLOW_POSTGRES_WORKER_CONCURRENCY (the WDK step pool)
    // and the provider's rate limit; transient 429/5xx are absorbed by retries.
    fileTaskConcurrency: envIntClamped("FILE_TASK_CONCURRENCY", 8, 1, 32),
    videoSegmentConcurrency: envIntClamped("VIDEO_SEGMENT_CONCURRENCY", 12, 1, 12),
  };
}
