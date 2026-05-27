import { request } from "./http";

export interface Bot {
  id: string;
  user_id: string;
  username: string;
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

export type AdminResourceStatus = "draft" | "active" | "disabled";

export interface AdminResource {
  id: string;
  user_id: string;
  username: string;
  name: string;
  description: string;
  status: AdminResourceStatus;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Intention extends AdminResource {
  scene_name: string;
  examples: number;
}

export type ResourceInput = Pick<
  AdminResource,
  "description" | "is_enabled" | "name" | "status"
>;

export type IntentionInput = ResourceInput &
  Pick<Intention, "examples" | "scene_name">;

function resourcePath(resource: "intentions" | "scenes", id?: string) {
  return id
    ? `/api/admin-server/${resource}/${id}`
    : `/api/admin-server/${resource}`;
}

export function fetchScenes(): Promise<AdminResource[]> {
  return request<AdminResource[]>({
    url: resourcePath("scenes"),
    method: "GET",
  });
}

export function fetchScene(id: string): Promise<AdminResource> {
  return request<AdminResource>({
    url: resourcePath("scenes", id),
    method: "GET",
  });
}

export function createScene(input: ResourceInput): Promise<AdminResource> {
  return request<AdminResource>({
    url: resourcePath("scenes"),
    method: "POST",
    data: input,
  });
}

export function updateScene(
  id: string,
  input: Partial<ResourceInput>,
): Promise<AdminResource> {
  return request<AdminResource>({
    url: resourcePath("scenes", id),
    method: "PATCH",
    data: input,
  });
}

export function deleteScene(id: string): Promise<void> {
  return request<void>({
    url: resourcePath("scenes", id),
    method: "DELETE",
  });
}

export function bulkDeleteScenes(ids: string[]): Promise<{ deleted: number }> {
  return request<{ deleted: number }>({
    url: `${resourcePath("scenes")}/bulk-delete`,
    method: "POST",
    data: { ids },
  });
}

export function fetchIntentions(): Promise<Intention[]> {
  return request<Intention[]>({
    url: resourcePath("intentions"),
    method: "GET",
  });
}

export function fetchIntention(id: string): Promise<Intention> {
  return request<Intention>({
    url: resourcePath("intentions", id),
    method: "GET",
  });
}

export function createIntention(input: IntentionInput): Promise<Intention> {
  return request<Intention>({
    url: resourcePath("intentions"),
    method: "POST",
    data: input,
  });
}

export function updateIntention(
  id: string,
  input: Partial<IntentionInput>,
): Promise<Intention> {
  return request<Intention>({
    url: resourcePath("intentions", id),
    method: "PATCH",
    data: input,
  });
}

export function deleteIntention(id: string): Promise<void> {
  return request<void>({
    url: resourcePath("intentions", id),
    method: "DELETE",
  });
}

export function bulkDeleteIntentions(
  ids: string[],
): Promise<{ deleted: number }> {
  return request<{ deleted: number }>({
    url: `${resourcePath("intentions")}/bulk-delete`,
    method: "POST",
    data: { ids },
  });
}
