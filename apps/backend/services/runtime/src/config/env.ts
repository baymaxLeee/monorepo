export type Environment = "development" | "staging" | "single-vps" | "production";

const environments = new Set<Environment>(["development", "staging", "single-vps", "production"]);

export function parseEnvironment(env: NodeJS.ProcessEnv): Environment {
  const value = env.ENVIRONMENT ?? "development";
  if (!environments.has(value as Environment)) {
    throw new Error(`unsupported ENVIRONMENT ${JSON.stringify(value)}`);
  }
  return value as Environment;
}

export function envOr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key] ?? fallback;
}

export function positiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

export function nonNegativeInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value;
}
