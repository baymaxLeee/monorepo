import { request } from "./http";

export interface Bot {
  id: string;
  user_id: string;
  name: string;
  status: "draft" | "published" | "archived";
  created_at: string;
}

export interface CreateBotInput {
  name: string;
}

export function fetchBots(): Promise<Bot[]> {
  return request<Bot[]>({
    url: "/api/admin-server/bot",
    method: "GET",
  });
}

export function fetchBot(id: string): Promise<Bot> {
  return request<Bot>({
    url: `/api/admin-server/bot/${id}`,
    method: "GET",
  });
}

export function createBot(input: CreateBotInput): Promise<Bot> {
  return request<Bot>({
    url: "/api/admin-server/bot",
    method: "POST",
    data: input,
  });
}
