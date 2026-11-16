export type Environment = "development" | "staging" | "single-vps" | "production";

export interface DatabaseSettings {
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
}

function envOr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function getDatabaseSettings(environment: Environment): DatabaseSettings {
  const postgresPassword = envOr("POSTGRES_PASSWORD", "runtime");
  const postgresHost = envOr("POSTGRES_HOST", "localhost");
  if (environment !== "development" && (!postgresPassword || postgresPassword === "runtime")) {
    throw new Error("POSTGRES_PASSWORD must be set explicitly outside development");
  }
  if (environment !== "development" && ["localhost", "127.0.0.1"].includes(postgresHost)) {
    throw new Error("POSTGRES_HOST must be set explicitly outside development");
  }
  return {
    postgresHost,
    postgresPort: envInt("POSTGRES_PORT", 5432),
    postgresUser: envOr("POSTGRES_USER", "runtime"),
    postgresPassword,
    postgresDatabase: envOr("POSTGRES_DATABASE", "runtime"),
  };
}
