import { type ApiRequestConfig, request } from "./http";

type RequestOptions = Pick<ApiRequestConfig, "signal" | "skipErrorNotify">;

export type BotStatus = "draft" | "published" | "archived";

export type BotTone = "professional" | "concise" | "friendly" | "empathetic";

export interface Bot {
  id: string;
  user_id: string;
  org_id: string | null;
  username: string;
  name: string;
  role_description: string | null;
  domain_description: string | null;
  audience: string | null;
  tone: BotTone;
  welcome_message: string | null;
  suggested_questions: string[];
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
  role_description?: string | null;
  domain_description?: string | null;
  audience?: string | null;
  tone?: BotTone;
  welcome_message?: string | null;
  suggested_questions?: string[];
  status?: BotStatus;
  text_provider_id?: string | null;
  image_provider_id?: string | null;
  video_provider_id?: string | null;
}

export function fetchBots(options?: RequestOptions): Promise<Bot[]> {
  return request<Bot[]>({
    url: "/api/admin-server/bot",
    method: "GET",
    ...options,
  });
}

export function fetchBot(id: string, options?: RequestOptions): Promise<Bot> {
  return request<Bot>({
    url: `/api/admin-server/bot/${id}`,
    method: "GET",
    ...options,
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

export type SkillStatus = "draft" | "published" | "archived";

// L1 list view: no `body`. Every listing surface (skills table, a bot's bound
// skills, the chat `/` picker) uses this so bodies are never fetched in bulk.
export interface SkillSummary {
  id: string;
  user_id: string;
  org_id: string;
  username: string;
  name: string;
  description: string;
  status: SkillStatus;
  is_enabled: boolean;
  has_unpublished_changes: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Skill extends SkillSummary {
  workspace_seq: number;
}

export interface CreateSkillInput {
  name: string;
  description: string;
}

export interface UpdateSkillInput {
  is_enabled?: boolean;
  status?: "draft" | "archived";
}

export interface SkillFileNode {
  id: string;
  name: string;
  type: "file" | "directory";
  parent_id?: string | null;
  mime_type?: string | null;
  etag: string;
  /**
   * File nodes only. `null` = content not included in tree listing (lazy-load via
   * GET /workspace/files/{id}); string = inline body (including empty file).
   */
  content?: string | null;
  children?: SkillFileNode[] | null;
}

export interface SkillWorkspace {
  skill_id: string;
  workspace_seq: number;
  tree: SkillFileNode[];
}

export interface SkillNodeMutationResult {
  workspace_seq: number;
  node_id: string;
  etag: string | null;
}

export interface SkillFileContent {
  id: string;
  content: string;
  etag: string;
}

export interface SkillValidationIssue {
  path: string;
  message: string;
}

export interface SkillValidationResult {
  ok: boolean;
  issues: SkillValidationIssue[];
}

function skillPath(id?: string) {
  return id ? `/api/admin-server/skills/${id}` : "/api/admin-server/skills";
}

export function fetchSkills(options?: RequestOptions): Promise<SkillSummary[]> {
  return request<SkillSummary[]>({
    url: skillPath(),
    method: "GET",
    ...options,
  });
}

export function fetchSkill(id: string): Promise<Skill> {
  return request<Skill>({ url: skillPath(id), method: "GET" });
}

export function createSkill(input: CreateSkillInput): Promise<Skill> {
  return request<Skill>({ url: skillPath(), method: "POST", data: input });
}

export function updateSkill(
  id: string,
  input: UpdateSkillInput,
): Promise<Skill> {
  return request<Skill>({ url: skillPath(id), method: "PATCH", data: input });
}

export function deleteSkill(id: string): Promise<void> {
  return request<void>({ url: skillPath(id), method: "DELETE" });
}

export function fetchSkillWorkspace(id: string): Promise<SkillWorkspace> {
  return request<SkillWorkspace>({
    url: `${skillPath(id)}/workspace`,
    method: "GET",
  });
}

export function fetchSkillFile(
  id: string,
  nodeId: string,
): Promise<SkillFileContent> {
  return request<SkillFileContent>({
    url: `${skillPath(id)}/workspace/files/${nodeId}`,
    method: "GET",
  });
}

export function createSkillNode(
  id: string,
  input: {
    id: string;
    parent_id: string | null;
    name: string;
    type: "file" | "directory";
    content?: string;
  },
): Promise<SkillNodeMutationResult> {
  return request<SkillNodeMutationResult>({
    url: `${skillPath(id)}/workspace/nodes`,
    method: "POST",
    data: input,
  });
}

export function updateSkillFileContent(
  id: string,
  nodeId: string,
  baseEtag: string,
  content: string,
): Promise<SkillNodeMutationResult> {
  return request<SkillNodeMutationResult>({
    url: `${skillPath(id)}/workspace/nodes/${nodeId}/content`,
    method: "PUT",
    data: { base_etag: baseEtag, content },
  });
}

export function renameSkillNode(
  id: string,
  nodeId: string,
  baseEtag: string,
  name: string,
): Promise<SkillNodeMutationResult> {
  return request<SkillNodeMutationResult>({
    url: `${skillPath(id)}/workspace/nodes/${nodeId}/name`,
    method: "PUT",
    data: { base_etag: baseEtag, name },
  });
}

export function moveSkillNode(
  id: string,
  nodeId: string,
  baseEtag: string,
  parentId: string | null,
): Promise<SkillNodeMutationResult> {
  return request<SkillNodeMutationResult>({
    url: `${skillPath(id)}/workspace/nodes/${nodeId}/parent`,
    method: "PUT",
    data: { base_etag: baseEtag, parent_id: parentId },
  });
}

export function deleteSkillNode(
  id: string,
  nodeId: string,
  baseEtag: string,
): Promise<SkillNodeMutationResult> {
  return request<SkillNodeMutationResult>({
    url: `${skillPath(id)}/workspace/nodes/${nodeId}`,
    method: "DELETE",
    params: { base_etag: baseEtag },
  });
}

export function validateSkill(id: string): Promise<SkillValidationResult> {
  return request<SkillValidationResult>({
    url: `${skillPath(id)}/validate`,
    method: "POST",
  });
}

export function publishSkill(
  id: string,
  baseWorkspaceSeq: number,
): Promise<{ skill: Skill; validation: SkillValidationResult }> {
  return request({
    url: `${skillPath(id)}/publish`,
    method: "POST",
    data: { base_workspace_seq: baseWorkspaceSeq },
  });
}

export function fetchBotSkills(
  botId: string,
  options?: RequestOptions,
): Promise<SkillSummary[]> {
  return request<SkillSummary[]>({
    url: `/api/admin-server/bot/${botId}/skills`,
    method: "GET",
    ...options,
  });
}

export function attachBotSkill(
  botId: string,
  skillId: string,
): Promise<SkillSummary[]> {
  return request<SkillSummary[]>({
    url: `/api/admin-server/bot/${botId}/skills`,
    method: "POST",
    data: { skill_id: skillId },
  });
}

export function detachBotSkill(
  botId: string,
  skillId: string,
): Promise<SkillSummary[]> {
  return request<SkillSummary[]>({
    url: `/api/admin-server/bot/${botId}/skills/${skillId}`,
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

export function fetchScenes(
  options?: RequestOptions,
): Promise<AdminResource[]> {
  return request<AdminResource[]>({
    url: resourcePath("scenes"),
    method: "GET",
    ...options,
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

export function fetchIntentions(
  options?: RequestOptions,
): Promise<Intention[]> {
  return request<Intention[]>({
    url: resourcePath("intentions"),
    method: "GET",
    ...options,
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

export function fetchModelProviders(
  options?: RequestOptions,
): Promise<ModelProvider[]> {
  return request<ModelProvider[]>({
    url: providerPath(),
    method: "GET",
    ...options,
  });
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
export function fetchApps(options?: RequestOptions): Promise<AppEntry[]> {
  return request<AppEntry[]>({
    url: appPath(),
    method: "GET",
    ...options,
  });
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
