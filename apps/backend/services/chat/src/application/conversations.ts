import { runtimeRequest } from "../infrastructure/clients/runtime.js";
import {
  createProductConversation,
  deleteProductConversation,
  getProductConversation,
  listProductConversations,
  type ProductConversation,
  updateProductConversation,
} from "../infrastructure/persistence/conversations.js";
import type { AuthContext } from "./auth.js";
import { RuntimeResponseError, NotFoundError, RequestError } from "./errors.js";

export function projectConversation(product: ProductConversation, value: unknown): Record<string, unknown> {
  const projected = projectRuntimeValue(product, value);
  const runtime = projected && typeof projected === "object" && !Array.isArray(projected) ? projected : {};
  return {
    ...runtime,
    id: product.id,
    user_id: product.user_id,
    tenant_id: product.tenant_id,
    workspace_id: product.workspace_id,
    title: product.title,
    project_id: product.project_id,
    canvas_id: product.canvas_id,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

export type PublicProductConversation = Omit<ProductConversation, "runtime_session_id" | "create_request_id">;

function publicConversation(product: ProductConversation): PublicProductConversation {
  const { runtime_session_id: _runtimeSessionId, create_request_id: _createRequestId, ...publicValue } = product;
  return publicValue;
}

export function projectRuntimeValue(product: ProductConversation, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => projectRuntimeValue(product, item));
  if (typeof value === "string") {
    return value.replaceAll(
      `/sessions/${encodeURIComponent(product.runtime_session_id)}`,
      `/conversations/${encodeURIComponent(product.id)}`,
    );
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      const projectedKey = key.replaceAll("sessionId", "conversationId").replaceAll("session_id", "conversation_id");
      const projectedChild =
        key === "id" && child === "session" && typeof (value as Record<string, unknown>).tokens === "number"
          ? "conversation"
          : child === product.runtime_session_id
            ? product.id
            : projectRuntimeValue(product, child);
      return [projectedKey, projectedChild];
    }),
  );
}

async function projectRuntimeResponse(product: ProductConversation, response: Response): Promise<Response> {
  if (!response.body || response.status === 204 || response.status === 304) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(projectRuntimeValue(product, await response.json())), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export interface CreateConversationInput {
  request_id: string;
  title?: string;
  provider_id?: string | null;
  project_id?: string;
  canvas_id?: string;
}

function runtimePath(product: ProductConversation, suffix = ""): string {
  return `/v1/sessions/${encodeURIComponent(product.runtime_session_id)}${suffix}`;
}

async function requireProductConversation(scope: AuthContext, conversationId: string): Promise<ProductConversation> {
  const product = await getProductConversation(scope, conversationId);
  if (!product) throw new NotFoundError("conversation not found");
  return product;
}

async function requireRuntimeResponse(response: Response): Promise<Response> {
  if (!response.ok) throw new RuntimeResponseError(response);
  return response;
}

export async function listConversations(scope: AuthContext): Promise<PublicProductConversation[]> {
  return (await listProductConversations(scope)).map(publicConversation);
}

export async function createConversation(
  scope: AuthContext,
  input: CreateConversationInput,
  request: Request,
): Promise<Record<string, unknown>> {
  const upstream = await requireRuntimeResponse(await runtimeRequest(request, "/v1/sessions", input));
  const runtime = (await upstream.json()) as { id: string };
  const product = await createProductConversation(scope, runtime.id, input);
  return projectConversation(product, runtime);
}

export async function createCanvasConversation(
  scope: AuthContext,
  input: CreateConversationInput,
  request: Request,
): Promise<ProductConversation> {
  const upstream = await requireRuntimeResponse(await runtimeRequest(request, "/v1/sessions", input));
  const runtime = (await upstream.json()) as { id: string };
  return createProductConversation(scope, runtime.id, input);
}

export async function getConversation(
  scope: AuthContext,
  conversationId: string,
  request: Request,
): Promise<Record<string, unknown>> {
  const product = await requireProductConversation(scope, conversationId);
  const upstream = await requireRuntimeResponse(await runtimeRequest(request, runtimePath(product)));
  return projectConversation(product, await upstream.json());
}

export async function updateConversation(
  scope: AuthContext,
  conversationId: string,
  title: string,
): Promise<PublicProductConversation> {
  const product = await requireProductConversation(scope, conversationId);
  return publicConversation((await updateProductConversation(scope, product.id, title))!);
}

export async function forkConversation(
  scope: AuthContext,
  conversationId: string,
  messageId: string,
  request: Request,
): Promise<Record<string, unknown>> {
  const source = await requireProductConversation(scope, conversationId);
  const upstream = await requireRuntimeResponse(
    await runtimeRequest(request, runtimePath(source, "/forks"), { message_id: messageId }),
  );
  const fork = (await upstream.json()) as { id: string; source_session_id: string; source_message_id: string };
  const product = await createProductConversation(scope, fork.id, {
    request_id: `fork:${fork.id}`,
    title: `${source.title.slice(0, 190)} · 分支`,
    project_id: source.project_id ?? undefined,
    canvas_id: source.canvas_id ?? undefined,
  });
  return { id: product.id, source_conversation_id: source.id, source_message_id: fork.source_message_id };
}

export async function deleteConversation(scope: AuthContext, conversationId: string, request: Request): Promise<void> {
  const product = await requireProductConversation(scope, conversationId);
  const upstream = await runtimeRequest(request, runtimePath(product));
  if (!upstream.ok && upstream.status !== 404) throw new RuntimeResponseError(upstream);
  await deleteProductConversation(scope, product.id);
}

export async function proxyConversationRequest(
  scope: AuthContext,
  conversationId: string,
  suffix: string,
  request: Request,
): Promise<Response> {
  const product = await requireProductConversation(scope, conversationId);
  if (suffix === "/agents/run/stream" && request.method === "POST") {
    const body = (await request.json()) as Record<string, unknown>;
    return projectRuntimeResponse(
      product,
      await runtimeRequest(
        request,
        `${runtimePath(product, suffix)}${new URL(request.url).search}`,
        runtimeRunBody(product, body),
      ),
    );
  }
  return projectRuntimeResponse(
    product,
    await runtimeRequest(request, `${runtimePath(product, suffix)}${new URL(request.url).search}`),
  );
}

export function runtimeRunBody(product: ProductConversation, body: Record<string, unknown>): Record<string, unknown> {
  if (body.id !== undefined && body.id !== product.id) {
    throw new RequestError("chat request id does not match the route conversation");
  }
  return {
    ...body,
    id: product.runtime_session_id,
    ...(product.project_id && product.canvas_id
      ? { host_context: { project_id: product.project_id, canvas_id: product.canvas_id } }
      : {}),
  };
}
