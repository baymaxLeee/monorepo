/**
 * Hand-written thin wrapper for the bot service API.
 *
 * In production, types here should be re-exported from `../generated/schema.d.ts`
 * (run `just gen-client` from apps/frontend or `just sync` from root).
 *
 * For now, we keep a manual interface so the demo runs without the codegen step.
 */
import { API_BASE_URL } from "@app/shared";

export interface Bot {
  id: string;
  name: string;
  status: "draft" | "published" | "archived";
  created_at: string;
}

export interface CreateBotInput {
  name: string;
}

const BASE = `${API_BASE_URL}/v1`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchBots(): Promise<Bot[]> {
  return request<Bot[]>("/bots");
}

export function fetchBot(id: string): Promise<Bot> {
  return request<Bot>(`/bots/${id}`);
}

export function createBot(input: CreateBotInput): Promise<Bot> {
  return request<Bot>("/bots", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
