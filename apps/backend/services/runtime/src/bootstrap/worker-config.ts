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
  internalApiToken: string;
  internalServiceTokens: Readonly<Record<string, string>>;
  adminServiceUrl: string;
  storageServiceUrl: string;
  knowledgeServiceUrl: string;
  ffmpegPath: string;
  videoSegmentConcurrency: number;
}

const DEV_INTERNAL_SERVICE_TOKENS = {
  runtime: "dev-runtime-internal-token",
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
  if (Object.keys(tokens).join(",") !== "runtime") {
    throw new Error("INTERNAL_SERVICE_TOKENS must define exactly runtime");
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

export function getWorkerSettings(): Settings {
  const environment = envOr("ENVIRONMENT", "development");
  if (!["development", "staging", "single-vps", "production"].includes(environment)) {
    throw new Error(`unsupported ENVIRONMENT ${JSON.stringify(environment)}`);
  }
  const internalApiToken = envOr("INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  const database = getDatabaseSettings(environment as Environment);
  if (environment !== "development" && (internalApiToken.length < 32 || internalApiToken.startsWith("dev-"))) {
    throw new Error("INTERNAL_API_TOKEN must be a strong workload credential outside development");
  }
  return {
    environment: environment as Environment,
    port: envInt("PORT", 8011),
    ...database,
    internalApiToken,
    internalServiceTokens: internalServiceTokens(environment as Environment),
    adminServiceUrl: envOr("ADMIN_SERVICE_URL", "http://localhost:8001"),
    storageServiceUrl: envOr("STORAGE_SERVICE_URL", "http://localhost:8013"),
    knowledgeServiceUrl: envOr("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    ffmpegPath: envOr("FFMPEG_PATH", "ffmpeg"),
    videoSegmentConcurrency: envIntClamped("VIDEO_SEGMENT_CONCURRENCY", 12, 1, 12),
  };
}
