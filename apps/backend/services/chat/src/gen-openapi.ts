import { z } from "zod";

import { inferenceConfigSchema, inferenceRequestSchema } from "./application/inference/generated/inference.js";

const inferenceJson = JSON.parse(
  JSON.stringify(z.toJSONSchema(inferenceRequestSchema, { target: "openapi-3.0", cycles: "ref" }), (key, value) =>
    key === "enum" && Array.isArray(value) && value.length === 1 && value[0] === null ? undefined : value,
  ).replaceAll("#/definitions/", "#/components/schemas/LocalInference"),
) as Record<string, unknown> & { definitions?: Record<string, object> };
const inferenceDefinitions = Object.fromEntries(
  Object.entries(inferenceJson.definitions ?? {}).map(([name, schema]) => [`LocalInference${name}`, schema]),
);
delete inferenceJson.definitions;

const pathParam = {
  name: "conversation_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const documentPathParam = {
  name: "document_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const sourcePathParam = {
  name: "source_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const runPathParam = {
  name: "run_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const clientMessagePathParam = {
  name: "client_message_id",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 8, maxLength: 64 },
};

const memoryIdPathParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const productionPathParam = {
  name: "production_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const shotPathParam = {
  name: "shot_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const takePathParam = {
  name: "take_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const fileIdPathParam = {
  name: "file_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonResponse = (description: string, schema: object) => ({
  description,
  content: { "application/json": { schema } },
});

const openapi = {
  openapi: "3.0.3",
  info: { title: "Chat Service", version: "0.1.0", description: "对话 / Agent 微服务 (TypeScript)" },
  paths: {
    "/local-inference/config": {
      get: {
        operationId: "getLocalInferenceConfig",
        parameters: [{ name: "agent_id", in: "query", schema: { type: "string" } }],
        responses: {
          "200": jsonResponse(
            "Authorized local model configuration, without provider secrets",
            z.toJSONSchema(inferenceConfigSchema, { target: "openapi-3.0" }),
          ),
        },
      },
    },
    "/local-inference/stream": {
      post: {
        operationId: "streamLocalInference",
        description:
          "Constrained AI SDK LanguageModelV4 inference relay. Native provider stream parts as NDJSON; no tool execution or conversation persistence. See schemas/desktop/README.md.",
        requestBody: { required: true, content: { "application/json": { schema: inferenceJson } } },
        responses: {
          "200": {
            description: "AI SDK LanguageModelV4StreamPart NDJSON",
            content: { "application/x-ndjson": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/conversations/canvas": {
      post: {
        operationId: "createCanvasConversation",
        requestBody: { required: true, content: { "application/json": { schema: ref("CanvasConversationInput") } } },
        responses: { "201": jsonResponse("Canvas-bound conversation", ref("CanvasConversationBinding")) },
      },
    },
    "/healthz": { get: { operationId: "chatHealthz", responses: { "200": { description: "ok" } } } },
    "/conversations": {
      get: {
        operationId: "listConversations",
        responses: { "200": jsonResponse("list conversations", { type: "array", items: ref("Conversation") }) },
      },
      post: {
        operationId: "createConversation",
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateConversationInput") } } },
        responses: { "201": jsonResponse("created conversation", ref("Conversation")) },
      },
    },
    "/conversations/{conversation_id}": {
      get: {
        operationId: "getConversation",
        parameters: [pathParam],
        responses: { "200": jsonResponse("selected conversation history", ref("ConversationDetail")) },
      },
      patch: {
        operationId: "updateConversation",
        parameters: [pathParam],
        requestBody: { required: true, content: { "application/json": { schema: ref("UpdateConversationInput") } } },
        responses: { "200": jsonResponse("updated conversation", ref("Conversation")) },
      },
      delete: {
        operationId: "deleteConversation",
        parameters: [pathParam],
        responses: { "204": { description: "delete conversation" } },
      },
    },
    "/conversations/{conversation_id}/history/select": {
      post: {
        operationId: "selectConversationHistory",
        parameters: [pathParam],
        requestBody: { required: true, content: { "application/json": { schema: ref("SelectHistoryInput") } } },
        responses: {
          "200": jsonResponse("selected root-to-leaf history", ref("ConversationDetail")),
          "404": { description: "leaf is not part of this conversation" },
          "409": { description: "stale revision or active run" },
        },
      },
    },
    "/conversations/{conversation_id}/forks": {
      post: {
        operationId: "forkConversation",
        parameters: [pathParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message_id"],
                properties: { message_id: { type: "string", minLength: 1, maxLength: 32 } },
              },
            },
          },
        },
        responses: {
          "201": jsonResponse("History branch with current immutable file snapshots; no tool replay", {
            type: "object",
            required: ["id", "source_conversation_id", "source_message_id"],
            properties: {
              id: { type: "string" },
              source_conversation_id: { type: "string" },
              source_message_id: { type: "string" },
            },
          }),
          "404": { description: "Source or checkpoint not found in the caller scope" },
          "409": { description: "Active run, processing files, or expired snapshot reservation" },
        },
      },
    },
    "/conversations/{conversation_id}/context": {
      get: {
        operationId: "getConversationContext",
        parameters: [pathParam],
        responses: {
          "200": jsonResponse("conversation context snapshot", ref("ConversationContextResponse")),
        },
      },
    },
    "/conversations/{conversation_id}/agents/run/stream": {
      get: {
        operationId: "resumeConversationAgentStream",
        parameters: [pathParam],
        responses: {
          "200": {
            description: "resume the active ToolLoopAgent UI message stream",
            headers: {
              "x-agent-run-id": {
                description: "Active agent run id",
                schema: { type: "string" },
              },
            },
          },
          "204": { description: "no active stream" },
        },
      },
      post: {
        operationId: "startConversationAgentStream",
        parameters: [pathParam],
        requestBody: { required: true, content: { "application/json": { schema: ref("AgentRunRequest") } } },
        responses: {
          "200": {
            description: "start ToolLoopAgent UI message stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
            headers: {
              "x-agent-run-id": {
                description: "Agent run id used for observability",
                schema: { type: "string" },
              },
            },
          },
        },
      },
    },
    "/conversations/{conversation_id}/documents/{document_id}": {
      get: {
        operationId: "getConversationDocument",
        parameters: [
          pathParam,
          documentPathParam,
          { name: "include_content", in: "query", schema: { type: "boolean", default: true } },
        ],
        responses: {
          "200": jsonResponse(
            "conversation document detail; include_content=false returns metadata with an empty content_md",
            ref("ConversationDocumentDetail"),
          ),
        },
      },
      patch: {
        operationId: "updateConversationDocument",
        parameters: [pathParam, documentPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateConversationDocumentInput") } },
        },
        responses: { "200": jsonResponse("updated conversation artifact", ref("ConversationDocumentDetail")) },
      },
    },
    "/conversations/{conversation_id}/documents/{document_id}/delivery": {
      post: {
        operationId: "authorizeConversationDocumentDelivery",
        parameters: [
          pathParam,
          documentPathParam,
          { name: "max_dim", in: "query", schema: { type: "integer", minimum: 1, maximum: 4096 } },
        ],
        responses: {
          "200": jsonResponse("authorized Storage capability", ref("StorageDelivery")),
          "404": { description: "document not accessible" },
        },
      },
    },
    "/conversations/{conversation_id}/files/{file_id}/delivery": {
      post: {
        operationId: "authorizeConversationFileDelivery",
        parameters: [
          pathParam,
          fileIdPathParam,
          { name: "revision_id", in: "query", required: false, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": jsonResponse("authorized Storage capability", ref("StorageDelivery")),
          "404": { description: "file not accessible" },
          "409": { description: "file changed since metadata was read" },
        },
      },
    },
    "/conversations/{conversation_id}/files/{file_id}/content": {
      get: {
        operationId: "redirectConversationFileContent",
        parameters: [pathParam, fileIdPathParam],
        responses: {
          "307": {
            description: "Authorized redirect to Storage",
            headers: { Location: { schema: { type: "string" } } },
          },
          "404": { description: "file not accessible" },
        },
      },
      patch: {
        operationId: "updateConversationFileContent",
        parameters: [pathParam, fileIdPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateConversationFileContentInput") } },
        },
        responses: {
          "200": jsonResponse("same conversation file pointing to the committed content", ref("ConversationFile")),
          "400": { description: "file is not editable UTF-8 text" },
          "413": { description: "file exceeds text editing byte budget" },
          "404": { description: "file not found in the caller scope" },
          "409": { description: "stale ETag, reused operation id, or save already in progress" },
        },
      },
    },
    "/conversations/{conversation_id}/documents/{document_id}/content": {
      get: {
        operationId: "redirectConversationDocumentContent",
        parameters: [pathParam, documentPathParam],
        responses: {
          "307": {
            description: "Authorized redirect to Storage",
            headers: { Location: { schema: { type: "string" } } },
          },
          "404": { description: "document not accessible" },
        },
      },
    },
    "/conversations/{conversation_id}/sources/{source_id}/delivery": {
      post: {
        operationId: "authorizeConversationSourceDelivery",
        parameters: [pathParam, sourcePathParam],
        responses: {
          "200": jsonResponse(
            "Journal-authorized Storage capability for a workspace Knowledge source",
            ref("StorageDelivery"),
          ),
          "404": { description: "source is not referenced by the selected history or is outside the workspace" },
        },
      },
    },
    "/conversations/{conversation_id}/files/{file_id}": {
      get: {
        operationId: "getConversationFile",
        parameters: [pathParam, fileIdPathParam],
        responses: {
          "200": jsonResponse("Chat-owned conversation file reference", ref("ConversationFile")),
          "404": { description: "file not found" },
        },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/trace": {
      get: {
        operationId: "getConversationAgentTrace",
        parameters: [pathParam, runPathParam],
        responses: {
          "200": jsonResponse("agent run step/tool-call trace", ref("AgentRunTrace")),
        },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/steer": {
      post: {
        operationId: "steerConversationAgentRun",
        parameters: [pathParam, runPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("AgentSteeringInput") } },
        },
        responses: {
          "202": jsonResponse("steering input admitted for the active run", ref("AgentSteeringInputStatus")),
          "409": { description: "the expected run is no longer active" },
        },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/steering-inputs/{client_message_id}": {
      get: {
        operationId: "getConversationAgentSteeringInput",
        parameters: [pathParam, runPathParam, clientMessagePathParam],
        responses: {
          "200": jsonResponse("durable steering delivery status", ref("AgentSteeringInputStatus")),
          "404": { description: "steering input not found in the caller scope" },
        },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/steering-inputs": {
      get: {
        operationId: "listConversationAgentSteeringInputs",
        parameters: [pathParam, runPathParam],
        responses: {
          "200": jsonResponse("durable steering inputs for recovery", {
            type: "array",
            items: ref("AgentSteeringInputStatus"),
          }),
          "404": { description: "agent run not found in the caller scope" },
        },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/cancel": {
      post: {
        operationId: "cancelConversationAgentRun",
        parameters: [pathParam, runPathParam],
        responses: { "200": jsonResponse("request agent run cancellation", ref("RunCancellation")) },
      },
    },
    "/conversations/{conversation_id}/video-productions/{production_id}": {
      get: {
        operationId: "getVideoProduction",
        parameters: [pathParam, productionPathParam],
        responses: {
          "200": jsonResponse("durable video production projection", ref("VideoProductionDetail")),
          "403": { description: "approval role required" },
          "404": { description: "video production not found" },
        },
      },
    },
    "/conversations/{conversation_id}/video-productions/{production_id}/decisions": {
      post: {
        operationId: "decideVideoProduction",
        parameters: [pathParam, productionPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("VideoProductionDecision") } },
        },
        responses: {
          "200": jsonResponse("updated durable video production projection", ref("VideoProduction")),
          "409": { description: "stale production version" },
        },
      },
    },
    "/conversations/{conversation_id}/video-productions/{production_id}/preview-url": {
      get: {
        operationId: "getVideoProductionPreviewUrl",
        parameters: [pathParam, productionPathParam],
        responses: {
          "200": {
            description: "staged video preview",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url", "expires_at"],
                  properties: { url: { type: "string" }, expires_at: { type: "string", format: "date-time" } },
                },
              },
            },
          },
          "404": { description: "preview not available" },
        },
      },
    },
    "/conversations/{conversation_id}/video-productions/{production_id}/shots/{shot_id}/takes/{take_id}/preview-url": {
      get: {
        operationId: "getVideoTakePreviewUrl",
        parameters: [pathParam, productionPathParam, shotPathParam, takePathParam],
        responses: {
          "200": {
            description: "staged video take preview",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url", "expires_at"],
                  properties: { url: { type: "string" }, expires_at: { type: "string", format: "date-time" } },
                },
              },
            },
          },
          "404": { description: "take preview not available" },
        },
      },
    },
    "/memories": {
      get: {
        operationId: "listActiveMemories",
        responses: {
          "200": jsonResponse("list active user memories", ref("UserMemoryList")),
        },
      },
    },
    "/memories/candidates": {
      get: {
        operationId: "listMemoryCandidates",
        responses: {
          "200": jsonResponse("list pending memory candidates", ref("MemoryCandidateList")),
        },
      },
    },
    "/memories/candidates/{id}/approve": {
      post: {
        operationId: "approveMemoryCandidate",
        parameters: [memoryIdPathParam],
        responses: {
          "200": jsonResponse("approve a memory candidate into active memory", ref("ApprovedMemory")),
        },
      },
    },
    "/memories/candidates/{id}/reject": {
      post: {
        operationId: "rejectMemoryCandidate",
        parameters: [memoryIdPathParam],
        responses: {
          "200": jsonResponse("reject a memory candidate", ref("RejectedMemory")),
        },
      },
    },
    "/memories/candidates/{id}": {
      patch: {
        operationId: "updateMemoryCandidate",
        parameters: [memoryIdPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateMemoryCandidate") } },
        },
        responses: {
          "200": jsonResponse("edit a pending memory candidate before approval", ref("UpdatedMemoryCandidate")),
        },
      },
    },
    "/memories/{id}": {
      delete: {
        operationId: "deleteMemory",
        parameters: [memoryIdPathParam],
        responses: {
          "200": jsonResponse("delete (deactivate) a stored memory", ref("DeletedMemory")),
        },
      },
    },
  },
  components: {
    schemas: {
      ...inferenceDefinitions,
      CanvasConversationInput: {
        type: "object",
        required: ["project_id", "canvas_id"],
        properties: {
          project_id: { type: "string", minLength: 1, maxLength: 36 },
          canvas_id: { type: "string", minLength: 1, maxLength: 36 },
          title: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      CanvasConversationBinding: {
        type: "object",
        required: ["id", "project_id", "canvas_id"],
        properties: {
          id: { type: "string" },
          project_id: { type: "string" },
          canvas_id: { type: "string" },
        },
      },
      CreateConversationInput: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          provider_id: { type: "string", maxLength: 32, nullable: true },
        },
      },
      UpdateConversationInput: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string", minLength: 1, maxLength: 200 } },
      },
      Conversation: {
        type: "object",
        required: [
          "id",
          "user_id",
          "tenant_id",
          "workspace_id",
          "title",
          "model",
          "provider_id",
          "active_plan_file_id",
          "project_id",
          "canvas_id",
          "created_at",
          "updated_at",
          "revision",
          "selected_message_id",
        ],
        properties: {
          id: { type: "string" },
          user_id: { type: "string" },
          tenant_id: { type: "string" },
          workspace_id: { type: "string" },
          title: { type: "string" },
          model: { type: "string" },
          provider_id: { type: "string" },
          active_plan_file_id: { type: "string", nullable: true },
          project_id: { type: "string", nullable: true },
          canvas_id: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          revision: { type: "integer", minimum: 0 },
          selected_message_id: { type: "string", nullable: true },
        },
      },
      AgentRunRequest: {
        type: "object",
        required: ["message", "trigger", "expected_revision", "request_id"],
        properties: {
          id: { type: "string" },
          message: { type: "object", additionalProperties: true },
          trigger: { type: "string", enum: ["submit-message", "regenerate-message"] },
          messageId: { type: "string", minLength: 1, maxLength: 32 },
          expected_revision: { type: "integer", minimum: 0 },
          request_id: { type: "string", minLength: 8, maxLength: 64, pattern: "^[a-zA-Z0-9_-]+$" },
          agent_id: { type: "string", maxLength: 32, nullable: true },
          mode: { type: "string", enum: ["normal", "plan"] },
        },
      },
      SelectHistoryInput: {
        type: "object",
        required: ["leaf_message_id", "expected_revision"],
        properties: {
          leaf_message_id: { type: "string", minLength: 1, maxLength: 32 },
          expected_revision: { type: "integer", minimum: 0 },
        },
      },
      PersistedMessageContent: {
        type: "object",
        required: ["version", "parts"],
        properties: {
          version: { type: "integer" },
          parts: { type: "array", items: { type: "object", additionalProperties: true } },
          metadata: { type: "object", additionalProperties: true },
        },
      },
      ConversationMessage: {
        type: "object",
        required: [
          "id",
          "conversation_id",
          "role",
          "content",
          "status",
          "parent_message_id",
          "branch_index",
          "created_at",
        ],
        properties: {
          id: { type: "string" },
          conversation_id: { type: "string" },
          role: { type: "string", enum: ["user", "assistant", "system"] },
          content: ref("PersistedMessageContent"),
          status: { type: "string", enum: ["ok", "streaming", "failed"] },
          parent_message_id: { type: "string", nullable: true },
          branch_index: { type: "integer", minimum: 0 },
          created_at: { type: "string", format: "date-time" },
        },
      },
      MessageBranchCandidate: {
        type: "object",
        required: ["message_id", "leaf_message_id", "role", "created_at"],
        properties: {
          message_id: { type: "string" },
          leaf_message_id: { type: "string" },
          role: { type: "string", enum: ["user", "assistant", "system"] },
          created_at: { type: "string", format: "date-time" },
        },
      },
      MessageBranchGroup: {
        type: "object",
        required: ["parent_message_id", "selected_message_id", "candidates"],
        properties: {
          parent_message_id: { type: "string", nullable: true },
          selected_message_id: { type: "string" },
          candidates: { type: "array", items: ref("MessageBranchCandidate") },
        },
      },
      ConversationDocument: {
        type: "object",
        required: [
          "id",
          "conversation_id",
          "kind",
          "editable_source",
          "title",
          "filename",
          "mime_type",
          "source_size",
          "source_mime_type",
          "asset_id",
          "source_revision_id",
          "source_sha256",
          "source_filename",
          "ingest_status",
          "ingest_progress",
          "ingest_error",
          "created_at",
          "updated_at",
        ],
        properties: {
          id: { type: "string" },
          conversation_id: { type: "string" },
          kind: { type: "string", enum: ["source", "artifact"] },
          editable_source: { type: "boolean" },
          title: { type: "string" },
          filename: { type: "string" },
          mime_type: { type: "string" },
          source_size: { type: "integer", minimum: 0 },
          source_mime_type: { type: "string", nullable: true },
          asset_id: { type: "string", nullable: true },
          source_revision_id: { type: "string", nullable: true },
          source_sha256: { type: "string", nullable: true },
          source_filename: { type: "string", nullable: true },
          ingest_status: {
            type: "string",
            enum: ["uploading", "processing", "completed", "failed", "cancelled", "pending"],
          },
          ingest_progress: { type: "integer", minimum: 0, maximum: 100 },
          ingest_error: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      ConversationDocumentDetail: {
        allOf: [
          ref("ConversationDocument"),
          {
            type: "object",
            required: ["content_md"],
            properties: { content_md: { type: "string" } },
          },
        ],
      },
      UpdateConversationDocumentInput: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          content_md: { type: "string" },
        },
      },
      ConversationDetail: {
        type: "object",
        required: [
          "id",
          "user_id",
          "tenant_id",
          "workspace_id",
          "title",
          "model",
          "provider_id",
          "created_at",
          "updated_at",
          "revision",
          "selected_message_id",
          "messages",
          "branches",
          "documents",
          "active_run_id",
          "latest_run_id",
        ],
        properties: {
          id: { type: "string" },
          user_id: { type: "string" },
          tenant_id: { type: "string" },
          workspace_id: { type: "string" },
          title: { type: "string" },
          model: { type: "string" },
          provider_id: { type: "string" },
          active_plan_file_id: { type: "string", nullable: true },
          project_id: { type: "string", nullable: true },
          canvas_id: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          revision: { type: "integer", minimum: 0 },
          selected_message_id: { type: "string", nullable: true },
          messages: { type: "array", items: ref("ConversationMessage") },
          branches: { type: "array", items: ref("MessageBranchGroup") },
          documents: { type: "array", items: ref("ConversationDocument") },
          active_run_id: { type: "string", nullable: true },
          latest_run_id: { type: "string", nullable: true },
        },
      },
      RunCancellation: {
        type: "object",
        required: ["cancelled"],
        properties: {
          cancelled: { type: "boolean" },
          status: { type: "string" },
        },
      },
      AgentSteeringInput: {
        type: "object",
        additionalProperties: false,
        required: ["expected_run_id", "client_message_id", "text", "delivery"],
        properties: {
          expected_run_id: { type: "string", minLength: 1, maxLength: 32 },
          client_message_id: {
            type: "string",
            minLength: 8,
            maxLength: 64,
            pattern: "^[a-zA-Z0-9_-]+$",
          },
          text: { type: "string", minLength: 1, maxLength: 64000 },
          delivery: { type: "string", enum: ["steer", "queue"] },
        },
      },
      AgentSteeringInputStatus: {
        type: "object",
        required: ["clientMessageId", "runId", "delivery", "text", "state", "stepNumber", "reason"],
        properties: {
          clientMessageId: { type: "string" },
          runId: { type: "string" },
          delivery: { type: "string", enum: ["steer", "queue"] },
          text: { type: "string" },
          state: {
            type: "string",
            enum: ["accepted", "dispatching", "delivered", "not_delivered", "unconfirmed"],
          },
          stepNumber: { type: "integer", nullable: true },
          reason: { type: "string", nullable: true },
        },
      },
      StorageDelivery: {
        type: "object",
        required: ["asset_id", "revision_id", "url", "expires_at", "filename", "media_type", "size_bytes"],
        properties: {
          asset_id: { type: "string" },
          revision_id: { type: "string" },
          url: { type: "string" },
          expires_at: { type: "string", format: "date-time" },
          filename: { type: "string" },
          media_type: { type: "string" },
          size_bytes: { type: "integer" },
        },
      },
      ConversationFile: {
        type: "object",
        required: [
          "id",
          "conversation_id",
          "asset_id",
          "revision_id",
          "title",
          "filename",
          "mime_type",
          "size",
          "sha256",
          "kind",
          "editable",
          "edit_max_bytes",
          "etag",
          "last_writer",
          "created_at",
          "updated_at",
        ],
        properties: {
          id: { type: "string" },
          conversation_id: { type: "string" },
          asset_id: { type: "string" },
          revision_id: { type: "string" },
          title: { type: "string" },
          filename: { type: "string" },
          mime_type: { type: "string" },
          size: { type: "integer" },
          sha256: { type: "string" },
          kind: { type: "string", enum: ["artifact", "plan"] },
          editable: { type: "boolean" },
          edit_max_bytes: { type: "integer", minimum: 1 },
          etag: { type: "string", pattern: '^"[a-f0-9]{32}"$' },
          last_writer: {
            type: "object",
            required: ["type", "id"],
            properties: {
              type: { type: "string", enum: ["unknown", "user", "agent"] },
              id: { type: "string", nullable: true },
            },
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      UpdateConversationFileContentInput: {
        type: "object",
        additionalProperties: false,
        required: ["content", "expected_etag", "operation_id"],
        properties: {
          content: { type: "string" },
          expected_etag: { type: "string", pattern: '^"[a-f0-9]{32}"$' },
          operation_id: { type: "string", minLength: 1, maxLength: 80 },
        },
      },
      AgentRunTrace: {
        type: "object",
        required: [
          "runId",
          "status",
          "model",
          "inputTokens",
          "outputTokens",
          "cachedInputTokens",
          "reasoningTokens",
          "totalTokens",
          "contextWindow",
          "steps",
          "toolCalls",
        ],
        properties: {
          runId: { type: "string" },
          status: { type: "string" },
          model: { type: "string" },
          inputTokens: { type: "integer", nullable: true },
          outputTokens: { type: "integer", nullable: true },
          cachedInputTokens: { type: "integer", nullable: true },
          reasoningTokens: { type: "integer", nullable: true },
          totalTokens: { type: "integer", nullable: true },
          contextWindow: { type: "integer", nullable: true },
          steps: {
            type: "array",
            items: {
              type: "object",
              required: [
                "id",
                "stepIndex",
                "kind",
                "status",
                "summary",
                "createdAt",
                "finishedAt",
                "inputTokens",
                "outputTokens",
                "totalTokens",
                "contextSnapshot",
              ],
              properties: {
                id: { type: "string" },
                stepIndex: { type: "integer" },
                kind: { type: "string" },
                status: { type: "string" },
                summary: { type: "string", nullable: true },
                createdAt: { type: "string", format: "date-time" },
                finishedAt: { type: "string", format: "date-time", nullable: true },
                inputTokens: { type: "integer", nullable: true },
                outputTokens: { type: "integer", nullable: true },
                totalTokens: { type: "integer", nullable: true },
                contextSnapshot: {
                  type: "object",
                  nullable: true,
                  required: [
                    "version",
                    "usedTokens",
                    "inputTokens",
                    "retainedOutputTokens",
                    "breakdownEstimated",
                    "categories",
                  ],
                  properties: {
                    version: { type: "integer", enum: [1] },
                    usedTokens: { type: "integer" },
                    inputTokens: { type: "integer" },
                    retainedOutputTokens: { type: "integer" },
                    breakdownEstimated: { type: "boolean", enum: [true] },
                    categories: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "tokens"],
                        properties: {
                          id: {
                            type: "string",
                            enum: ["system", "tools", "rules", "skills", "mcp", "memory", "conversation"],
                          },
                          tokens: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          toolCalls: {
            type: "array",
            items: ref("AgentTraceToolCall"),
          },
        },
      },
      AgentTraceToolCall: {
        type: "object",
        required: ["id", "stepIndex", "toolName", "status", "durationMs", "error"],
        properties: {
          id: { type: "string" },
          stepIndex: { type: "integer", nullable: true },
          toolName: { type: "string" },
          status: { type: "string", enum: ["running", "completed", "failed"] },
          durationMs: { type: "integer", nullable: true },
          error: { type: "string", nullable: true },
        },
      },
      ConversationContextCategory: {
        type: "object",
        required: ["id", "tokens"],
        properties: {
          id: {
            type: "string",
            enum: ["system", "tools", "rules", "skills", "mcp", "memory", "conversation"],
          },
          tokens: { type: "integer" },
        },
      },
      ConversationContextView: {
        type: "object",
        required: ["contextWindow", "usedTokens", "categories"],
        properties: {
          contextWindow: { type: "integer", nullable: true },
          usedTokens: { type: "integer" },
          categories: {
            type: "array",
            items: ref("ConversationContextCategory"),
          },
        },
      },
      ConversationContextResponse: {
        type: "object",
        required: ["context"],
        properties: {
          context: {
            allOf: [ref("ConversationContextView")],
            nullable: true,
          },
        },
      },
      VideoShot: {
        type: "object",
        required: [
          "id",
          "order",
          "seconds",
          "narrativeBeat",
          "subjectAnchors",
          "action",
          "camera",
          "environment",
          "lightingPalette",
          "audioDirection",
          "references",
          "continuityContract",
          "acceptanceCriteria",
        ],
        properties: {
          id: { type: "string" },
          order: { type: "integer" },
          seconds: { type: "integer" },
          narrativeBeat: { type: "string" },
          subjectAnchors: { type: "array", items: { type: "string" } },
          action: { type: "string" },
          camera: {
            type: "object",
            required: ["shotSize", "movement"],
            properties: {
              shotSize: { type: "string" },
              movement: { type: "string" },
              focus: { type: "string" },
            },
          },
          environment: { type: "string" },
          lightingPalette: { type: "string" },
          audioDirection: { type: "string" },
          references: { type: "array", items: { type: "object", additionalProperties: true } },
          continuityContract: { type: "array", items: { type: "string" } },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
        },
      },
      VideoShotPlan: {
        type: "object",
        required: ["version", "shots"],
        properties: {
          version: { type: "integer" },
          shots: { type: "array", items: ref("VideoShot") },
        },
      },
      VideoTake: {
        type: "object",
        required: ["id", "shotId", "number", "status", "seed"],
        properties: {
          id: { type: "string" },
          shotId: { type: "string" },
          number: { type: "integer" },
          status: { type: "string", enum: ["generating", "succeeded", "failed"] },
          providerTaskId: { type: "string" },
          stagedMediaId: { type: "string" },
          seed: { type: "integer" },
          error: { type: "string" },
        },
      },
      VideoProduction: {
        type: "object",
        required: [
          "id",
          "taskId",
          "tenantId",
          "workspaceId",
          "userId",
          "title",
          "status",
          "stage",
          "version",
          "shotReviews",
          "cost",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          taskId: { type: "string" },
          tenantId: { type: "string" },
          workspaceId: { type: "string" },
          userId: { type: "string" },
          conversationId: { type: "string", nullable: true },
          title: { type: "string" },
          status: { type: "string", enum: ["running", "awaiting_approval", "completed", "failed", "cancelled"] },
          stage: { type: "string" },
          version: { type: "integer" },
          awaitingAction: { type: "string", nullable: true },
          shotPlan: { ...ref("VideoShotPlan"), nullable: true },
          shotReviews: {
            type: "array",
            items: {
              type: "object",
              required: ["shotId", "selectedTakeId", "takes"],
              properties: {
                shotId: { type: "string" },
                selectedTakeId: { type: "string", nullable: true },
                takes: { type: "array", items: ref("VideoTake") },
              },
            },
          },
          cost: {
            type: "object",
            required: [
              "currency",
              "unitPriceMicros",
              "estimatedMicros",
              "budgetLimitMicros",
              "reservedMicros",
              "reconciledMicros",
              "releasedMicros",
            ],
            properties: {
              currency: { type: "string", nullable: true },
              unitPriceMicros: { type: "integer", nullable: true },
              estimatedMicros: { type: "integer", nullable: true },
              budgetLimitMicros: { type: "integer", nullable: true },
              reservedMicros: { type: "integer" },
              reconciledMicros: { type: "integer" },
              releasedMicros: { type: "integer" },
            },
          },
          stagedMediaId: { type: "string", nullable: true },
          documentId: { type: "string", nullable: true },
          qaReport: { type: "object", nullable: true, additionalProperties: true },
          error: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      VideoProductionDetail: {
        type: "object",
        required: ["production", "events"],
        properties: {
          production: ref("VideoProduction"),
          events: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      VideoProductionDecision: {
        oneOf: [
          {
            type: "object",
            required: ["action", "action_id", "expected_version", "shot_plan"],
            properties: {
              action: { type: "string", enum: ["revise_storyboard"] },
              action_id: { type: "string" },
              expected_version: { type: "integer" },
              shot_plan: ref("VideoShotPlan"),
            },
          },
          {
            type: "object",
            required: ["action", "action_id", "expected_version", "budget_limit_micros", "currency"],
            properties: {
              action: { type: "string", enum: ["approve_storyboard"] },
              action_id: { type: "string" },
              expected_version: { type: "integer" },
              budget_limit_micros: { type: "integer", minimum: 0 },
              currency: { type: "string", minLength: 3, maxLength: 3 },
            },
          },
          {
            type: "object",
            required: ["action", "action_id", "expected_version", "shot_id"],
            properties: {
              action: { type: "string", enum: ["request_take"] },
              action_id: { type: "string" },
              expected_version: { type: "integer" },
              shot_id: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["action", "action_id", "expected_version", "selections"],
            properties: {
              action: { type: "string", enum: ["approve_takes"] },
              action_id: { type: "string" },
              expected_version: { type: "integer" },
              selections: {
                type: "array",
                items: {
                  type: "object",
                  required: ["shot_id", "take_id"],
                  properties: {
                    shot_id: { type: "string" },
                    take_id: { type: "string" },
                  },
                },
              },
            },
          },
          {
            type: "object",
            required: ["action", "action_id", "expected_version"],
            properties: {
              action: { type: "string", enum: ["approve_publish"] },
              action_id: { type: "string" },
              expected_version: { type: "integer" },
              waiver_reason: { type: "string", minLength: 1, maxLength: 1000 },
            },
          },
          {
            type: "object",
            required: ["action", "action_id", "expected_version", "reason"],
            properties: {
              action: { type: "string", enum: ["reject_publish"] },
              action_id: { type: "string" },
              expected_version: { type: "integer" },
              reason: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["action", "action_id", "expected_version", "reason"],
            properties: {
              action: { type: "string", enum: ["reject_storyboard"] },
              action_id: { type: "string" },
              expected_version: { type: "integer" },
              reason: { type: "string" },
            },
          },
        ],
      },
      MemoryCategory: {
        type: "string",
        enum: ["preference", "profile", "project", "instruction"],
      },
      UserMemory: {
        type: "object",
        required: ["id", "category", "content", "confidence"],
        properties: {
          id: { type: "string" },
          category: ref("MemoryCategory"),
          content: { type: "string" },
          confidence: { type: "integer" },
        },
      },
      MemoryCandidate: {
        type: "object",
        required: ["id", "category", "content", "reason", "supersedesId", "createdAt"],
        properties: {
          id: { type: "string" },
          category: ref("MemoryCategory"),
          content: { type: "string" },
          reason: { type: "string", nullable: true },
          supersedesId: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      UserMemoryList: {
        type: "object",
        required: ["memories"],
        properties: { memories: { type: "array", items: ref("UserMemory") } },
      },
      MemoryCandidateList: {
        type: "object",
        required: ["candidates"],
        properties: { candidates: { type: "array", items: ref("MemoryCandidate") } },
      },
      UpdateMemoryCandidate: {
        type: "object",
        minProperties: 1,
        properties: {
          category: ref("MemoryCategory"),
          content: { type: "string", minLength: 5, maxLength: 500 },
        },
      },
      ApprovedMemory: {
        type: "object",
        required: ["memory"],
        properties: { memory: ref("UserMemory") },
      },
      UpdatedMemoryCandidate: {
        type: "object",
        required: ["candidate"],
        properties: { candidate: ref("MemoryCandidate") },
      },
      RejectedMemory: {
        type: "object",
        required: ["rejected"],
        properties: { rejected: { type: "boolean" } },
      },
      DeletedMemory: {
        type: "object",
        required: ["deleted"],
        properties: { deleted: { type: "boolean" } },
      },
    },
  },
};

process.stdout.write(`${JSON.stringify(openapi, null, 2)}\n`);
