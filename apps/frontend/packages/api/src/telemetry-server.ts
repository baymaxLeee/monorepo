import { request } from "./http";

export interface TelemetryErrorEvent {
  app: string;
  device_id: string;
  fingerprint: string;
  is_admin: boolean;
  message: string;
  name: string;
  payload: Record<string, unknown>;
  release: string;
  route: string;
  session_id: string;
  stack: string;
  trace_id: string | null;
  ts_server: string;
  user_id: string | null;
  username: string | null;
}

export function fetchTelemetryErrors(limit = 100): Promise<{
  items: TelemetryErrorEvent[];
}> {
  return request({
    url: "/api/telemetry-server/errors",
    method: "GET",
    params: { limit },
  });
}
