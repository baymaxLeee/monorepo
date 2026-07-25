import type { ObservabilityApp, ObservabilityConfig, ObservabilityUser } from "./types";

type RuntimeContext = Required<Pick<ObservabilityConfig, "app" | "endpoint" | "release" | "sampleRate">> & {
  user: ObservabilityUser | null;
};

const defaultContext: RuntimeContext = {
  app: "platform",
  endpoint: "/api/telemetry-server/rum/batch",
  release: "dev",
  sampleRate: 1,
  user: null,
};

let context = { ...defaultContext };

export function configureObservability(config: ObservabilityConfig): void {
  context = {
    ...context,
    app: config.app,
    endpoint: config.endpoint ?? context.endpoint,
    release: config.release ?? context.release,
    sampleRate: config.sampleRate ?? context.sampleRate,
  };
}

export function getObservabilityContext(): RuntimeContext {
  return context;
}

export function setUser(user: ObservabilityUser): void {
  context = { ...context, user };
}

export function clearUser(): void {
  context = { ...context, user: null };
}

export function setRelease(release: string): void {
  context = { ...context, release };
}

export function setApp(app: ObservabilityApp): void {
  context = { ...context, app };
}
