import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function productName(value: string): string {
  return value
    .replaceAll("Sessions", "Conversations")
    .replaceAll("Session", "Conversation")
    .replaceAll("sessionId", "conversationId")
    .replaceAll("session_id", "conversation_id");
}

function projectRuntimeContract(value: Json): Json {
  if (Array.isArray(value)) return value.map(projectRuntimeContract);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [productName(key), projectRuntimeContract(child)]),
    );
  }
  return typeof value === "string" ? productName(value) : value;
}

const runtimeContract = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../../../schemas/openapi/runtime-server.json"), "utf8"),
) as JsonObject;
const contract = projectRuntimeContract(runtimeContract) as JsonObject;
const paths = contract.paths as JsonObject;
contract.paths = Object.fromEntries(
  Object.entries(paths).map(([path, operation]) => [path.replace(/^\/(?:v1\/)?sessions/, "/conversations"), operation]),
);
contract.info = {
  ...(contract.info as JsonObject),
  title: "Chat Product API",
  description: "Thin Web conversation product facade over Runtime",
};
((contract.paths as JsonObject)["/healthz"] as JsonObject).get = {
  ...(((contract.paths as JsonObject)["/healthz"] as JsonObject).get as JsonObject),
  operationId: "chatHealthz",
};

const schemas = ((contract.components as JsonObject).schemas ?? {}) as JsonObject;
const string = { type: "string" } satisfies JsonObject;
schemas.CreateConversationInput = {
  type: "object",
  required: ["request_id"],
  additionalProperties: false,
  properties: {
    request_id: { type: "string", minLength: 8, maxLength: 64 },
    title: { type: "string", minLength: 1, maxLength: 200 },
    provider_id: { type: "string", maxLength: 32, nullable: true },
    project_id: { type: "string", maxLength: 36 },
    canvas_id: { type: "string", maxLength: 36 },
  },
};
schemas.UpdateConversationInput = {
  type: "object",
  required: ["title"],
  additionalProperties: false,
  properties: { title: { type: "string", minLength: 1, maxLength: 200 } },
};
schemas.Conversation = {
  type: "object",
  required: [
    "id",
    "user_id",
    "tenant_id",
    "workspace_id",
    "title",
    "project_id",
    "canvas_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: string,
    user_id: string,
    tenant_id: string,
    workspace_id: string,
    title: string,
    project_id: { type: "string", nullable: true },
    canvas_id: { type: "string", nullable: true },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
};
const conversationDetail = schemas.ConversationDetail as JsonObject;
conversationDetail.required = [...((conversationDetail.required as Json[]) ?? []), "title"];
conversationDetail.properties = {
  ...(conversationDetail.properties as JsonObject),
  title: string,
  project_id: { type: "string", nullable: true },
  canvas_id: { type: "string", nullable: true },
};
const contextCategory = schemas.ConversationContextCategory as JsonObject;
const contextProperties = contextCategory.properties as JsonObject;
const contextId = contextProperties.id as JsonObject;
contextId.enum = ((contextId.enum as Json[]) ?? []).map((value) => (value === "session" ? "conversation" : value));
schemas.CanvasConversationBinding = {
  type: "object",
  required: ["id", "project_id", "canvas_id"],
  properties: { id: string, project_id: string, canvas_id: string },
};

const conversationPath = (contract.paths as JsonObject)["/conversations/{conversation_id}"] as JsonObject;
conversationPath.patch = {
  operationId: "updateConversation",
  parameters: [{ name: "conversation_id", in: "path", required: true, schema: string }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateConversationInput" } } },
  },
  responses: {
    "200": {
      description: "updated conversation metadata",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Conversation" } } },
    },
  },
};
(contract.paths as JsonObject)["/conversations/canvas"] = {
  post: {
    operationId: "createCanvasConversation",
    requestBody: {
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/CreateConversationInput" } } },
    },
    responses: {
      "201": {
        description: "Canvas-bound conversation",
        content: { "application/json": { schema: { $ref: "#/components/schemas/CanvasConversationBinding" } } },
      },
    },
  },
};

process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
