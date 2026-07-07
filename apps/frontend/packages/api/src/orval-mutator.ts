import type { AxiosRequestConfig } from "axios";
import { type ApiRequestConfig, request } from "./http";

export function apiMutator<T>(
  config: AxiosRequestConfig,
  options?: ApiRequestConfig,
): Promise<T> {
  return request<T>({
    ...config,
    ...options,
    headers: {
      ...config.headers,
      ...options?.headers,
    },
  });
}
