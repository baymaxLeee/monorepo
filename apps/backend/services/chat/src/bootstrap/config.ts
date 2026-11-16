export interface Settings {
  port: number;
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
  runtimeServiceUrl: string;
  internalApiToken: string;
}

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const envInt = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export function getSettings(): Settings {
  return {
    port: envInt("PORT", 8009),
    postgresHost: env("POSTGRES_HOST", "localhost"),
    postgresPort: envInt("POSTGRES_PORT", 5432),
    postgresUser: env("POSTGRES_USER", "chat"),
    postgresPassword: env("POSTGRES_PASSWORD", "chat"),
    postgresDatabase: env("POSTGRES_DATABASE", "chat"),
    runtimeServiceUrl: env("RUNTIME_SERVICE_URL", "http://localhost:8015"),
    internalApiToken: env("INTERNAL_API_TOKEN", "dev-chat-internal-token"),
  };
}
