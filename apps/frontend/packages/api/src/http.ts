import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios";
import { attachAxios, type MinimalAxiosInstance } from "observability";
import { toast } from "sonner";
import { getToken, isAccessTokenValid } from "./storage";

declare const process: { env: { API_BASE_URL?: string } } | undefined;

const rawApiBaseUrl =
  (typeof window !== "undefined" &&
    (window as { __API_BASE__?: string }).__API_BASE__) ||
  (typeof process !== "undefined" ? process.env.API_BASE_URL : undefined) ||
  "";

export const API_BASE_URL = normalizeApiBaseURL(rawApiBaseUrl);

/**
 * Per-request options layered on top of axios config.
 *
 * `skipErrorNotify` suppresses the interceptor's global error toast — used by
 * background probes (token refresh, account-availability) and by reads that
 * render their own inline error UI, so the same failure is never surfaced
 * twice.
 */
export interface ApiRequestConfig extends AxiosRequestConfig {
  skipErrorNotify?: boolean;
}

export const apiHttp: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

attachAxios(apiHttp as unknown as MinimalAxiosInstance);

let refreshAccessToken: (() => Promise<boolean>) | null = null;

export function setRefreshAccessToken(handler: () => Promise<boolean>): void {
  refreshAccessToken = handler;
}

// 401 on these paths is an auth outcome (bad credentials / no session), not an
// expired access token — refreshing would be a pointless extra round-trip.
const NO_REFRESH_PATHS = [
  "/api/iam-server/login",
  "/api/iam-server/register",
  "/api/iam-server/refresh",
  "/api/iam-server/account-availability",
];

const GATEWAY_PREFIX_BY_ROOT_SEGMENT: Record<string, string> = {
  "account-availability": "/api/iam-server",
  login: "/api/iam-server",
  logout: "/api/iam-server",
  me: "/api/iam-server",
  orgs: "/api/iam-server",
  refresh: "/api/iam-server",
  register: "/api/iam-server",
  roles: "/api/iam-server",
  users: "/api/iam-server",
  apps: "/api/admin-server",
  bots: "/api/admin-server",
  intentions: "/api/admin-server",
  providers: "/api/admin-server",
  scenes: "/api/admin-server",
  skills: "/api/admin-server",
  conversations: "/api/chat-server",
  memories: "/api/chat-server",
  documents: "/api/knowledge-server",
  ingest: "/api/knowledge-server",
  errors: "/api/telemetry-server",
  ops: "/api/telemetry-server",
  performance: "/api/telemetry-server",
  rum: "/api/telemetry-server",
};

const GATEWAY_PREFIX_BY_LOCAL_PORT: Record<string, string> = {
  "8001": "/api/admin-server",
  "8002": "/api/iam-server",
  "8008": "/api/telemetry-server",
  "8009": "/api/chat-server",
  "8010": "/api/knowledge-server",
};

apiHttp.interceptors.request.use(async (config) => {
  const target = normalizeRequestTarget(config.url, config.baseURL);
  config.url = target.url;
  config.baseURL = target.baseURL;

  const skipProactiveRefresh = NO_REFRESH_PATHS.some((path) =>
    config.url?.includes(path),
  );
  if (!skipProactiveRefresh && !isAccessTokenValid()) {
    await refreshAccessToken?.();
  }

  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiHttp.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as
      | (ApiRequestConfig & { __retried?: boolean })
      | undefined;

    const canRefresh =
      error.response?.status === 401 &&
      !!config &&
      !config.__retried &&
      !NO_REFRESH_PATHS.some((path) => config.url?.includes(path));

    if (canRefresh && config) {
      config.__retried = true;
      const refreshed = await refreshAccessToken?.();
      if (refreshed) {
        return apiHttp(config);
      }
    }

    const apiError = toApiError(error);
    if (!config?.skipErrorNotify) {
      toast.error(apiError.message);
    }
    throw apiError;
  },
);

export async function request<T>(config: ApiRequestConfig): Promise<T> {
  const response = await apiHttp.request<T>(config);
  return response.data;
}

export type ApiProblem = {
  detail?: string;
  message?: string;
  title?: string;
};

/**
 * Normalized API error. Carries the backend `status`/`code` so callers can
 * branch on them (e.g. 403 → "no access") while the human message is already
 * unwrapped from the RFC7807 problem body.
 */
export class ApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = options?.status;
    this.code = options?.code;
  }
}

export function toApiError(error: unknown): ApiError {
  if (!axios.isAxiosError<ApiProblem>(error)) {
    const message = error instanceof Error ? error.message : String(error);
    return new ApiError(message);
  }
  const data = error.response?.data;
  const message = data?.detail ?? data?.message ?? data?.title ?? error.message;
  return new ApiError(message, {
    status: error.response?.status,
    code: data?.title,
  });
}

function normalizeApiBaseURL(value: string): string {
  if (isLocalBackendOrigin(value)) {
    return "";
  }
  return value;
}

function normalizeRequestTarget(
  url: string | undefined,
  baseURL: string | undefined,
): { url: string | undefined; baseURL: string | undefined } {
  const direct = normalizeDirectLocalUrl(url);
  if (direct) {
    return { url: direct, baseURL: "" };
  }

  const normalizedBaseURL = normalizeApiBaseURL(baseURL ?? "");
  if (
    !url?.startsWith("/") ||
    url.startsWith("/api/") ||
    gatewayServiceBaseURL(normalizedBaseURL)
  ) {
    return { url, baseURL: normalizedBaseURL };
  }

  const segment = url.slice(1).split("/", 1)[0];
  const prefix = GATEWAY_PREFIX_BY_ROOT_SEGMENT[segment];
  return { url: prefix ? `${prefix}${url}` : url, baseURL: normalizedBaseURL };
}

function normalizeDirectLocalUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!isLocalHostname(parsed.hostname)) {
    return null;
  }
  if (parsed.port === "8000") {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  const prefix = GATEWAY_PREFIX_BY_LOCAL_PORT[parsed.port];
  if (!prefix) {
    return null;
  }
  return `${prefix}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function gatewayServiceBaseURL(value: string | undefined): boolean {
  return (
    typeof value === "string" &&
    /\/api\/[a-z-]+$/.test(value.replace(/\/$/, ""))
  );
}

function isLocalBackendOrigin(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    isLocalHostname(parsed.hostname) &&
    (parsed.port === "8000" || parsed.port in GATEWAY_PREFIX_BY_LOCAL_PORT)
  );
}

function isLocalHostname(value: string): boolean {
  return value === "localhost" || value === "127.0.0.1";
}
