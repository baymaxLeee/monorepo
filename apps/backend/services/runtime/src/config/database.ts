import { envOr, parseEnvironment, positiveInt, type Environment } from "./env.js";

export interface DatabaseSettings {
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
}

export function parseDatabaseSettings(environment: Environment, env: NodeJS.ProcessEnv): DatabaseSettings {
  const postgresPassword = envOr(env, "POSTGRES_PASSWORD", "runtime");
  const postgresHost = envOr(env, "POSTGRES_HOST", "localhost");
  if (environment !== "development" && (!postgresPassword || postgresPassword === "runtime")) {
    throw new Error("POSTGRES_PASSWORD must be set explicitly outside development");
  }
  if (environment !== "development" && ["localhost", "127.0.0.1"].includes(postgresHost)) {
    throw new Error("POSTGRES_HOST must be set explicitly outside development");
  }
  return {
    postgresHost,
    postgresPort: positiveInt(env, "POSTGRES_PORT", 5432),
    postgresUser: envOr(env, "POSTGRES_USER", "runtime"),
    postgresPassword,
    postgresDatabase: envOr(env, "POSTGRES_DATABASE", "runtime"),
  };
}

let cached: DatabaseSettings | undefined;

export function getDatabaseSettings(): DatabaseSettings {
  cached ??= parseDatabaseSettings(parseEnvironment(process.env), process.env);
  return cached;
}
