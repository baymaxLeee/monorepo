import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios";
import { attachAxios, type MinimalAxiosInstance } from "observability";
import { toast } from "sonner";
import { getToken } from "./storage";

declare const process: { env: { API_BASE_URL?: string } } | undefined;

export const API_BASE_URL =
  (typeof window !== "undefined" &&
    (window as { __API_BASE__?: string }).__API_BASE__) ||
  (typeof process !== "undefined" ? process.env.API_BASE_URL : undefined) ||
  "";

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

apiHttp.interceptors.request.use((config) => {
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
