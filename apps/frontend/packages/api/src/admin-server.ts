import { request } from "./http";

export type BotStatus = "draft" | "published" | "archived";

export interface Bot {
  id: string;
  user_id: string;
  username: string;
  name: string;
  status: BotStatus;
  text_provider_id: string | null;
  image_provider_id: string | null;
  video_provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBotInput {
  name: string;
}

export interface UpdateBotInput {
  name?: string;
  status?: BotStatus;
  text_provider_id?: string | null;
  image_provider_id?: string | null;
  video_provider_id?: string | null;
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

export function updateBot(id: string, input: UpdateBotInput): Promise<Bot> {
  return request<Bot>({
    url: `/api/admin-server/bot/${id}`,
    method: "PATCH",
    data: input,
  });
}

export function deleteBot(id: string): Promise<void> {
  return request<void>({
    url: `/api/admin-server/bot/${id}`,
    method: "DELETE",
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

export type ProviderKind = "chat" | "image" | "video" | "embedding" | "rerank";

export interface ModelProvider {
  id: string;
  user_id: string;
  name: string;
  model: string;
  provider_kind: ProviderKind;
  base_url: string;
  api_key_masked: string;
  extra_body: Record<string, unknown>;
  context_window: number;
  max_output_tokens: number;
  supports_image_input: boolean;
  is_default: boolean;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateModelProviderInput {
  name: string;
  model: string;
  provider_kind?: ProviderKind;
  base_url: string;
  api_key: string;
  extra_body?: Record<string, unknown>;
  context_window?: number;
  max_output_tokens?: number;
  supports_image_input?: boolean;
  is_default?: boolean;
  is_enabled?: boolean;
}

export interface UpdateModelProviderInput {
  name?: string;
  model?: string;
  provider_kind?: ProviderKind;
  base_url?: string;
  api_key?: string;
  extra_body?: Record<string, unknown> | null;
  context_window?: number;
  max_output_tokens?: number;
  supports_image_input?: boolean;
  is_default?: boolean;
  is_enabled?: boolean;
}

export interface TestModelProviderInput {
  model?: string;
  base_url?: string;
  api_key?: string;
}

export interface TestModelProviderResult {
  ok: boolean;
  latency_ms?: number | null;
  sample?: string | null;
  error?: string | null;
}

function providerPath(id?: string) {
  return id
    ? `/api/admin-server/providers/${id}`
    : "/api/admin-server/providers";
}

export function fetchModelProviders(): Promise<ModelProvider[]> {
  return request<ModelProvider[]>({ url: providerPath(), method: "GET" });
}

export function fetchModelProvider(id: string): Promise<ModelProvider> {
  return request<ModelProvider>({ url: providerPath(id), method: "GET" });
}

export function createModelProvider(
  input: CreateModelProviderInput,
): Promise<ModelProvider> {
  return request<ModelProvider>({
    url: providerPath(),
    method: "POST",
    data: input,
  });
}

export function updateModelProvider(
  id: string,
  input: UpdateModelProviderInput,
): Promise<ModelProvider> {
  return request<ModelProvider>({
    url: providerPath(id),
    method: "PATCH",
    data: input,
  });
}

export function deleteModelProvider(id: string): Promise<void> {
  return request<void>({ url: providerPath(id), method: "DELETE" });
}

export function setDefaultModelProvider(id: string): Promise<ModelProvider> {
  return request<ModelProvider>({
    url: `${providerPath(id)}/set-default`,
    method: "POST",
  });
}

export function testModelProvider(
  id: string,
  input: TestModelProviderInput = {},
): Promise<TestModelProviderResult> {
  return request<TestModelProviderResult>({
    url: `${providerPath(id)}/test`,
    method: "POST",
    data: input,
  });
}

/** A platform app/product entry. Mirrors admin `App` schema. */
export interface AppEntry {
  id: string;
  title: string;
  base_path: string;
  remote_name: string;
  expose_key: string;
  entry: string;
  requires_admin: boolean;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAppInput {
  id: string;
  title: string;
  base_path: string;
  remote_name: string;
  expose_key?: string;
  entry?: string;
  requires_admin?: boolean;
  is_enabled?: boolean;
  sort_order?: number;
}

export type UpdateAppInput = Partial<Omit<CreateAppInput, "id">>;

function appPath(id?: string) {
  return id ? `/api/admin-server/apps/${id}` : "/api/admin-server/apps";
}

/** Apps the current user may mount (server-filtered by user type). */
export function fetchApps(): Promise<AppEntry[]> {
  return request<AppEntry[]>({ url: appPath(), method: "GET" });
}

export function createApp(input: CreateAppInput): Promise<AppEntry> {
  return request<AppEntry>({ url: appPath(), method: "POST", data: input });
}

export function updateApp(
  id: string,
  input: UpdateAppInput,
): Promise<AppEntry> {
  return request<AppEntry>({ url: appPath(id), method: "PATCH", data: input });
}

export function deleteApp(id: string): Promise<void> {
  return request<void>({ url: appPath(id), method: "DELETE" });
}
