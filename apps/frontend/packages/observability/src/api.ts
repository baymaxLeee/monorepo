import { configureObservability, getObservabilityContext } from "./context";
import { createTraceId, traceHeaders } from "./trace";
import { enqueue, flush, flushWithBeacon } from "./transport/queue";
import { redact } from "./transport/redact";
import type {
  MinimalAxiosInstance,
  ObservabilityConfig,
  ObservabilityEvent,
  ObservabilityEventType,
  TelemetryScope,
  TrackOptions,
} from "./types";

type AxiosRequestConfigLike = Record<string, unknown> & {
  headers?: Record<string, unknown>;
  metadata?: { startedAt?: number; traceId?: string };
  method?: string;
  url?: string;
};

type AxiosResponseLike = Record<string, unknown> & {
  config?: AxiosRequestConfigLike;
  status?: number;
};

type AxiosErrorLike = {
  config?: AxiosRequestConfigLike;
  message?: string;
  response?: { status?: number };
};

export function initObservability(config: ObservabilityConfig): void {
  configureObservability(config);
  installGlobalHandlers();
  observePageLifecycle();
  recordPageView();
}

export function attachAxios(instance: MinimalAxiosInstance): void {
  instance.interceptors.request.use((config) => {
    const next = config as AxiosRequestConfigLike;
    const traceId = createTraceId();
    next.metadata = {
      ...(next.metadata ?? {}),
      startedAt: performance.now(),
      traceId,
    };
    next.headers = { ...(next.headers ?? {}), ...traceHeaders(traceId) };
    return next;
  });

  instance.interceptors.response.use(
    (response) => {
      recordHttp(response as AxiosResponseLike);
      return response;
    },
    async (error) => {
      const err = error as AxiosErrorLike;
      recordHttpError(err);
      throw error;
    },
  );
}

export const telemetry = createTelemetryScope();

export function createTelemetryScope(scope: TelemetryScope = {}) {
  return {
    captureException(
      error: unknown,
      attrs: Record<string, unknown> = {},
      options: TrackOptions = {},
    ) {
      track(
        "error",
        {
          ...errorPayload(error),
          ...attrs,
        },
        scope,
        options,
      );
    },
    event(
      name: string,
      attrs: Record<string, unknown> = {},
      options: TrackOptions = {},
    ) {
      track("event", { name, ...attrs }, scope, options);
    },
    flush,
    scope(nextScope: TelemetryScope) {
      return createTelemetryScope({ ...scope, ...nextScope });
    },
    warn(
      message: string,
      attrs: Record<string, unknown> = {},
      options: TrackOptions = {},
    ) {
      track("warning", { message, ...attrs }, scope, options);
    },
  };
}

export function track(
  type: ObservabilityEventType,
  payload: Record<string, unknown>,
  scope: TelemetryScope = {},
  options: TrackOptions = {},
): void {
  const context = getObservabilityContext();
  const safePayload = redact(payload);
  const event: ObservabilityEvent = {
    type,
    ts_client: Date.now(),
    trace_id: options.traceId ?? null,
    route: location.pathname,
    payload: {
      ...(isRecord(safePayload) ? safePayload : {}),
      remote_name: scope.remoteName,
    },
  };
  enqueue(scope.app ?? context.app, event);
}

function recordHttp(response: AxiosResponseLike): void {
  const config = response.config;
  if (!config || isObservabilityUrl(config.url)) return;
  const traceId = config.metadata?.traceId ?? null;
  const duration = config.metadata?.startedAt
    ? performance.now() - config.metadata.startedAt
    : 0;
  track(
    "perform",
    {
      metric: "http",
      method: String(config.method ?? "GET").toUpperCase(),
      status_code: response.status ?? 0,
      url: config.url ?? "",
      value: Math.round(duration),
    },
    {},
    { traceId },
  );
}

function recordHttpError(error: AxiosErrorLike): void {
  const config = error.config;
  if (!config || isObservabilityUrl(config.url)) return;
  const traceId = config.metadata?.traceId ?? null;
  recordHttp({
    config,
    status: error.response?.status ?? 0,
  });
  track(
    "error",
    {
      message: error.message ?? "HTTP request failed",
      name: "HttpError",
      status_code: error.response?.status ?? 0,
      url: config.url ?? "",
    },
    {},
    { traceId },
  );
}

function installGlobalHandlers(): void {
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        track("error", {
          message: "Resource failed to load",
          name: "ResourceError",
          source: resourceSource(target),
          tag: target.tagName.toLowerCase(),
        });
        return;
      }
      track("error", {
        colno: event.colno,
        filename: event.filename,
        lineno: event.lineno,
        ...errorPayload(event.error ?? event.message),
      });
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    track("error", {
      ...errorPayload(event.reason),
      name: "UnhandledRejection",
    });
  });
}

function observePageLifecycle(): void {
  window.addEventListener("pagehide", flushWithBeacon);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWithBeacon();
  });
}

export function recordPageView(): void {
  track("event", {
    name: "page_view",
    title: document.title,
  });
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? "",
    };
  }
  return {
    message: String(error),
    name: "Error",
  };
}

function resourceSource(target: HTMLElement): string {
  if (target instanceof HTMLScriptElement) return target.src;
  if (target instanceof HTMLImageElement) return target.src;
  if (target instanceof HTMLLinkElement) return target.href;
  return "";
}

function isObservabilityUrl(url: unknown): boolean {
  return typeof url === "string" && url.includes("/api/telemetry-server/rum");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
