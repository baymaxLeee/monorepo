import { parseDatabaseSettings } from "./database.js";
import { envOr, parseEnvironment, positiveInt, type Environment } from "./env.js";

const DEV_INTERNAL_TOKEN = "dev-runtime-internal-token";
const DEV_INTERNAL_SERVICE_TOKENS = { runtime: DEV_INTERNAL_TOKEN } as const;

export interface WorkerSettings {
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
  workflowTargetWorld: string;
  workflowWorkerConcurrency: number;
  workflowMaxPoolSize: number;
  workflowJobLockStaleSeconds: number;
}

function parseInternalServiceTokens(
  environment: Environment,
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  const raw = envOr(env, "INTERNAL_SERVICE_TOKENS", JSON.stringify(DEV_INTERNAL_SERVICE_TOKENS));
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
  return tokens as Record<string, string>;
}

export function parseWorkerSettings(env: NodeJS.ProcessEnv): WorkerSettings {
  const environment = parseEnvironment(env);
  const internalApiToken = envOr(env, "INTERNAL_API_TOKEN", DEV_INTERNAL_TOKEN);
  if (environment !== "development" && (internalApiToken.length < 32 || internalApiToken.startsWith("dev-"))) {
    throw new Error("INTERNAL_API_TOKEN must be a strong workload credential outside development");
  }
  const workflowTargetWorld = envOr(env, "WORKFLOW_TARGET_WORLD", "");
  if (environment !== "development" && workflowTargetWorld !== "@workflow/world-postgres") {
    throw new Error("WORKFLOW_TARGET_WORLD must select @workflow/world-postgres outside development");
  }
  return {
    environment,
    port: positiveInt(env, "PORT", 8011),
    ...parseDatabaseSettings(environment, env),
    internalApiToken,
    internalServiceTokens: parseInternalServiceTokens(environment, env),
    adminServiceUrl: envOr(env, "ADMIN_SERVICE_URL", "http://localhost:8001"),
    storageServiceUrl: envOr(env, "STORAGE_SERVICE_URL", "http://localhost:8013"),
    knowledgeServiceUrl: envOr(env, "KNOWLEDGE_SERVICE_URL", "http://localhost:8010"),
    ffmpegPath: envOr(env, "FFMPEG_PATH", "ffmpeg"),
    videoSegmentConcurrency: Math.min(positiveInt(env, "VIDEO_SEGMENT_CONCURRENCY", 12), 12),
    workflowTargetWorld,
    workflowWorkerConcurrency: positiveInt(env, "WORKFLOW_POSTGRES_WORKER_CONCURRENCY", 50),
    workflowMaxPoolSize: positiveInt(env, "WORKFLOW_POSTGRES_MAX_POOL_SIZE", 52),
    workflowJobLockStaleSeconds: positiveInt(env, "WORKFLOW_POSTGRES_JOB_LOCK_STALE_SECONDS", 30),
  };
}

let cached: WorkerSettings | undefined;

export function getWorkerSettings(): WorkerSettings {
  cached ??= parseWorkerSettings(process.env);
  return cached;
}

export function prepareWorkerEnvironment(): WorkerSettings {
  const settings = getWorkerSettings();
  if (settings.workflowTargetWorld) {
    const managedShutdown = process.env.WORKFLOW_POSTGRES_APPLICATION_MANAGED_SHUTDOWN;
    if (managedShutdown && managedShutdown !== "1") {
      throw new Error("WORKFLOW_POSTGRES_APPLICATION_MANAGED_SHUTDOWN must be 1");
    }
    process.env.WORKFLOW_POSTGRES_APPLICATION_MANAGED_SHUTDOWN = "1";
    process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY ??= String(settings.workflowWorkerConcurrency);
    process.env.WORKFLOW_POSTGRES_MAX_POOL_SIZE ??= String(settings.workflowMaxPoolSize);
    process.env.WORKFLOW_POSTGRES_JOB_LOCK_STALE_SECONDS ??= String(settings.workflowJobLockStaleSeconds);
  }
  return settings;
}
