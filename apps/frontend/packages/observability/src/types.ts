export type ObservabilityApp = "mfe-admin" | "platform";

export type ObservabilityEventType = "error" | "event" | "perform" | "warning";

export type ObservabilityUser = {
  userId: string;
  username?: string;
};

export type ObservabilityConfig = {
  app: ObservabilityApp;
  endpoint?: string;
  release?: string;
  sampleRate?: number;
};

export type ObservabilityEvent = {
  type: ObservabilityEventType;
  ts_client: number;
  trace_id?: string | null;
  route: string;
  payload: Record<string, unknown>;
};

export type RumBatch = {
  app: ObservabilityApp;
  release: string;
  device_id: string;
  session_id: string;
  user_agent: string;
  events: ObservabilityEvent[];
};

export type TelemetryScope = {
  app?: ObservabilityApp;
  remoteName?: string;
};

export type TrackOptions = {
  traceId?: string | null;
};

export type MinimalAxiosInstance = {
  interceptors: {
    request: {
      use: (onFulfilled: (config: Record<string, unknown>) => Record<string, unknown>) => unknown;
    };
    response: {
      use: (
        onFulfilled: (response: Record<string, unknown>) => Record<string, unknown>,
        onRejected: (error: unknown) => Promise<never>,
      ) => unknown;
    };
  };
};

export type { MinimalAxiosInstance as AxiosObservabilityTarget };
