import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios";
import { attachAxios, type MinimalAxiosInstance } from "@packages/observability";
import { getToken } from "./storage";

// Resolution order:
// 1. window.__API_BASE__   — runtime override for standalone MFE preview
// 2. process.env.API_BASE_URL — baked in at build time by host rspack DefinePlugin
// 3. ""                    — same-origin (dev proxy or same-origin prod)
declare const process: { env: { API_BASE_URL?: string } } | undefined;

export const API_BASE_URL =
  (typeof window !== "undefined" &&
    (window as { __API_BASE__?: string }).__API_BASE__) ||
  (typeof process !== "undefined" ? process.env.API_BASE_URL : undefined) ||
  "";

export const apiHttp: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

attachAxios(apiHttp as unknown as MinimalAxiosInstance);

let refreshAccessToken: (() => Promise<boolean>) | null = null;

export function setRefreshAccessToken(handler: () => Promise<boolean>): void {
  refreshAccessToken = handler;
}

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
      | (AxiosRequestConfig & { __retried?: boolean })
      | undefined;
    if (
      error.response?.status !== 401 ||
      !config ||
      config.__retried ||
      config.url?.includes("/api/iam-server/refresh")
    ) {
      throw toApiError(error);
    }

    config.__retried = true;
    const refreshed = await refreshAccessToken?.();
    if (!refreshed) {
      throw toApiError(error);
    }
    return apiHttp(config);
  },
);

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await apiHttp.request<T>(config);
  return response.data;
}

export type ApiProblem = {
  detail?: string;
  message?: string;
  title?: string;
};

export function toApiError(error: unknown): Error {
  if (!axios.isAxiosError<ApiProblem>(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const detail =
    error.response?.data?.detail ??
    error.response?.data?.message ??
    error.response?.data?.title ??
    error.message;
  return new Error(detail);
}
