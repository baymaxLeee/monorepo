import { z } from "zod";

import { prepareAttachmentSchema, completeAttachmentSchema } from "../../api/http/attachment-schemas.js";
import { inferenceConfigSchema, inferenceRequestSchema } from "../../application/inference/generated/inference.js";

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
  name: "session_id",
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
  info: {
    title: "Runtime Server",
    version: "1.0.0",
    description: "Session persistence and interactive ToolLoopAgent runtime",
  },
  paths: {
    "/local-inference/config": {
      post: {
        operationId: "resolveLocalInferenceConfig",
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("LocalInferenceConfigRequest") } },
        },
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
          "Constrained AI SDK LanguageModelV4 inference relay. Native provider stream parts as NDJSON; no tool execution or session persistence. See schemas/desktop/README.md.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("LocalInferenceStreamRequest") } },
        },
        responses: {
          "200": {
            description: "AI SDK LanguageModelV4StreamPart NDJSON",
            content: { "application/x-ndjson": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/healthz": { get: { operationId: "runtimeHealthz", responses: { "200": { description: "ok" } } } },
    "/sessions": {
      post: {
        operationId: "createSession",
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateSessionInput") } } },
        responses: { "201": jsonResponse("created session", ref("Session")) },
      },
    },
    "/sessions/{session_id}": {
      get: {
        operationId: "getSession",
        parameters: [pathParam],
        responses: { "200": jsonResponse("selected session history", ref("SessionDetail")) },
      },
      delete: {
        operationId: "deleteSession",
        parameters: [pathParam],
        responses: { "204": { description: "delete session" } },
      },
    },
    "/sessions/{session_id}/model": {
      patch: {
        operationId: "updateSessionModel",
        parameters: [pathParam],
        requestBody: { required: true, content: { "application/json": { schema: ref("UpdateSessionModelInput") } } },
        responses: {
          "200": jsonResponse("updated conversation model binding", ref("Session")),
          "409": { description: "conversation has an active run" },
        },
      },
    },
    "/sessions/{session_id}/execution-policy": {
      patch: {
        operationId: "updateSessionExecutionPolicy",
        parameters: [pathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateSessionExecutionPolicyInput") } },
        },
        responses: {
          "200": jsonResponse("updated conversation execution policy", ref("Session")),
          "409": { description: "conversation has an active run" },
        },
      },
    },
    "/sessions/{session_id}/history/select": {
      post: {
        operationId: "selectSessionHistory",
        parameters: [pathParam],
        requestBody: { required: true, content: { "application/json": { schema: ref("SelectHistoryInput") } } },
        responses: {
          "200": jsonResponse("selected root-to-leaf history", ref("SessionDetail")),
          "404": { description: "leaf is not part of this session" },
          "409": { description: "stale revision or active run" },
        },
      },
    },
    "/sessions/{session_id}/forks": {
      post: {
        operationId: "forkSession",
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
            required: ["id", "source_session_id", "source_message_id"],
            properties: {
              id: { type: "string" },
              source_session_id: { type: "string" },
              source_message_id: { type: "string" },
            },
          }),
          "404": { description: "Source or checkpoint not found in the caller scope" },
          "409": { description: "Active run, processing files, or expired snapshot reservation" },
        },
      },
    },
    "/sessions/{session_id}/context": {
      get: {
        operationId: "getSessionContext",
        parameters: [pathParam],
        responses: {
          "200": jsonResponse("session context snapshot", ref("SessionContextResponse")),
        },
      },
    },
    "/sessions/{session_id}/stream": {
      get: {
        operationId: "resumeSessionStream",
        parameters: [pathParam],
        responses: {
          "200": {
            description: "materialized active Turn snapshot followed by live UI message events",
            content: { "text/event-stream": { schema: { type: "string" } } },
            headers: {
              "x-agent-run-id": {
                description: "Active agent run id",
                schema: { type: "string" },
              },
            },
          },
          "204": {
            description: "no local stream; x-agent-run-state distinguishes terminal idle from an active detached Turn",
            headers: {
              "x-agent-run-id": {
                description: "Active Turn id when the stream is detached from this process",
                schema: { type: "string" },
              },
              "x-agent-run-state": {
                description: "idle or active-detached",
                schema: { type: "string", enum: ["idle", "active-detached"] },
              },
            },
          },
        },
      },
      post: {
        operationId: "startSessionStream",
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
          "409": {
            description: "the request was already claimed; resume a detached Turn or read the settled journal",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["code", "message"],
                  properties: {
                    code: { type: "string", enum: ["active_run_detached", "run_settled"] },
                    message: { type: "string" },
                  },
                },
              },
            },
            headers: {
              "x-agent-run-id": { description: "Previously claimed Turn id", schema: { type: "string" } },
              "x-agent-run-state": {
                description: "resume or journal recovery state",
                schema: { type: "string", enum: ["active-detached", "settled"] },
              },
            },
          },
        },
      },
    },
    "/sessions/{session_id}/attachments/prepare": {
      post: {
        operationId: "prepareSessionAttachment",
        parameters: [pathParam],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: z.toJSONSchema(prepareAttachmentSchema, { target: "openapi-3.0" }) },
          },
        },
        responses: {
          "200": jsonResponse("Storage upload capability for this attachment", {
            type: "object",
            required: ["upload_id", "upload_url", "completed"],
            properties: {
              upload_id: { type: "string", format: "uuid" },
              upload_url: { type: "string" },
              completed: { type: "boolean" },
            },
          }),
        },
      },
    },
    "/sessions/{session_id}/attachments/complete": {
      post: {
        operationId: "completeSessionAttachment",
        parameters: [pathParam],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: z.toJSONSchema(completeAttachmentSchema, { target: "openapi-3.0" }) },
          },
        },
        responses: {
          "200": jsonResponse("immutable session attachment", ref("SessionFile")),
          "404": { description: "upload not found in session" },
          "409": { description: "upload incomplete" },
        },
      },
    },
    "/sessions/{session_id}/files/{file_id}/delivery": {
      post: {
        operationId: "authorizeSessionFileDelivery",
        parameters: [
          pathParam,
          fileIdPathParam,
          { name: "max_dim", in: "query", schema: { type: "integer", minimum: 1, maximum: 4096 } },
          { name: "revision_id", in: "query", required: false, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": jsonResponse("authorized Storage capability", ref("StorageDelivery")),
          "404": { description: "file not accessible" },
          "409": { description: "file changed since metadata was read" },
        },
      },
    },
    "/sessions/{session_id}/files/{file_id}/content": {
      get: {
        operationId: "redirectSessionFileContent",
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
        operationId: "updateSessionFileContent",
        parameters: [pathParam, fileIdPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateSessionFileContentInput") } },
        },
        responses: {
          "200": jsonResponse("same session file pointing to the committed content", ref("SessionFile")),
          "400": { description: "file is not editable UTF-8 text" },
          "413": { description: "file exceeds text editing byte budget" },
          "404": { description: "file not found in the caller scope" },
          "409": { description: "stale ETag, reused operation id, or save already in progress" },
        },
      },
    },
    "/sessions/{session_id}/files/{file_id}": {
      get: {
        operationId: "getSessionFile",
        parameters: [pathParam, fileIdPathParam],
        responses: {
          "200": jsonResponse("Runtime-owned session file reference", ref("SessionFile")),
          "404": { description: "file not found" },
        },
      },
    },
    "/sessions/{session_id}/agents/runs/{run_id}/trace": {
      get: {
        operationId: "getSessionAgentTrace",
        parameters: [pathParam, runPathParam],
        responses: {
          "200": jsonResponse("agent run step/tool-call trace", ref("AgentRunTrace")),
        },
      },
    },
    "/sessions/{session_id}/agents/runs/{run_id}/inputs": {
      post: {
        operationId: "submitSessionAgentRunInput",
        parameters: [pathParam, runPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("AgentRunInput") } },
        },
        responses: {
          "202": jsonResponse("input admitted for the active run", ref("AgentRunInputStatus")),
          "409": { description: "the expected run is no longer active" },
        },
      },
      get: {
        operationId: "listSessionAgentRunInputs",
        parameters: [pathParam, runPathParam],
        responses: {
          "200": jsonResponse("durable run inputs for recovery", {
            type: "array",
            items: ref("AgentRunInputStatus"),
          }),
          "404": { description: "agent run not found in the caller scope" },
        },
      },
    },
    "/sessions/{session_id}/agents/runs/{run_id}/inputs/{client_message_id}": {
      get: {
        operationId: "getSessionAgentRunInput",
        parameters: [pathParam, runPathParam, clientMessagePathParam],
        responses: {
          "200": jsonResponse("durable run input status", ref("AgentRunInputStatus")),
          "404": { description: "run input not found in the caller scope" },
        },
      },
    },
    "/sessions/{session_id}/agents/runs/{run_id}/cancel": {
      post: {
        operationId: "cancelSessionAgentRun",
        parameters: [pathParam, runPathParam],
        responses: { "200": jsonResponse("request agent run cancellation", ref("RunCancellation")) },
      },
    },
  },
  components: {
    schemas: {
      ...inferenceDefinitions,
      RuntimeProviderCapability: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "model",
          "baseUrl",
          "apiKey",
          "extraBody",
          "contextWindow",
          "maxOutputTokens",
          "supportsImageInput",
        ],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 32 },
          name: { type: "string", minLength: 1, maxLength: 120 },
          model: { type: "string", minLength: 1, maxLength: 120 },
          baseUrl: { type: "string", format: "uri", maxLength: 2048 },
          apiKey: { type: "string", minLength: 1, maxLength: 16384 },
          extraBody: { type: "object", additionalProperties: true },
          contextWindow: { type: "integer", minimum: 1 },
          maxOutputTokens: { type: "integer", minimum: 0 },
          supportsImageInput: { type: "boolean" },
          providerKind: { type: "string", maxLength: 64 },
        },
      },
      LocalInferenceConfigRequest: {
        type: "object",
        additionalProperties: false,
        required: ["provider", "reasoningEffort"],
        properties: {
          provider: ref("RuntimeProviderCapability"),
          reasoningEffort: ref("ReasoningEffort"),
        },
      },
      LocalInferenceStreamRequest: {
        type: "object",
        additionalProperties: false,
        required: ["provider", "request"],
        properties: {
          provider: ref("RuntimeProviderCapability"),
          request: inferenceJson,
        },
      },
      CreateSessionInput: {
        type: "object",
        required: ["request_id"],
        additionalProperties: false,
        properties: {
          request_id: { type: "string", minLength: 8, maxLength: 64 },
          provider_id: { type: "string", maxLength: 32, nullable: true },
          model: { type: "string", maxLength: 120, nullable: true },
          reasoning_effort: { ...ref("ReasoningEffort"), nullable: true },
          approval_policy: { ...ref("ApprovalPolicy"), nullable: true },
          permission_profile: { ...ref("PermissionProfile"), nullable: true },
        },
      },
      ReasoningEffort: {
        type: "string",
        enum: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      },
      ApprovalPolicy: {
        type: "string",
        enum: ["never", "on-request", "unless-trusted", "granular"],
      },
      PermissionProfile: {
        type: "string",
        enum: [":read-only", ":workspace", ":danger-full-access"],
      },
      UpdateSessionModelInput: {
        type: "object",
        required: ["provider_id", "model", "reasoning_effort"],
        additionalProperties: false,
        properties: {
          provider_id: { type: "string", minLength: 1, maxLength: 32 },
          model: { type: "string", minLength: 1, maxLength: 120 },
          reasoning_effort: ref("ReasoningEffort"),
        },
      },
      UpdateSessionExecutionPolicyInput: {
        type: "object",
        required: ["approval_policy", "permission_profile"],
        additionalProperties: false,
        properties: {
          approval_policy: ref("ApprovalPolicy"),
          permission_profile: ref("PermissionProfile"),
        },
      },
      Session: {
        type: "object",
        required: [
          "id",
          "model",
          "provider_id",
          "reasoning_effort",
          "approval_policy",
          "permission_profile",
          "created_at",
          "updated_at",
          "revision",
          "selected_message_id",
        ],
        properties: {
          id: { type: "string" },
          model: { type: "string" },
          provider_id: { type: "string" },
          reasoning_effort: ref("ReasoningEffort"),
          approval_policy: ref("ApprovalPolicy"),
          permission_profile: ref("PermissionProfile"),
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          revision: { type: "integer", minimum: 0 },
          selected_message_id: { type: "string", nullable: true },
        },
      },
      AgentRunRequest: {
        type: "object",
        additionalProperties: false,
        required: ["message", "trigger", "expected_revision", "request_id", "capabilities"],
        properties: {
          id: { type: "string" },
          message: { type: "object", additionalProperties: true },
          trigger: { type: "string", enum: ["submit-message", "regenerate-message"] },
          messageId: { type: "string", minLength: 1, maxLength: 32 },
          expected_revision: { type: "integer", minimum: 0 },
          request_id: { type: "string", minLength: 8, maxLength: 64, pattern: "^[a-zA-Z0-9_-]+$" },
          generate_title: { type: "boolean" },
          client_capabilities: {
            type: "object",
            additionalProperties: false,
            properties: { ui_agent: { type: "string", enum: ["ui-sdk"] } },
          },
          capabilities: ref("TurnCapabilities"),
        },
      },
      TurnCapabilities: {
        type: "object",
        additionalProperties: false,
        required: ["provider", "media", "plugins", "skills", "memories"],
        properties: {
          provider: ref("RuntimeProviderCapability"),
          media: ref("RuntimeMediaCapabilities"),
          plugins: {
            type: "object",
            description: "Validated immutable plugin snapshot with ephemeral opaque connection grants",
            additionalProperties: true,
          },
          skills: { type: "array", maxItems: 64, items: ref("FrozenSkillSnapshot") },
          memories: { type: "array", maxItems: 64, items: ref("MemoryDatum") },
        },
      },
      RuntimeMediaCapabilities: {
        type: "object",
        additionalProperties: false,
        required: ["providers"],
        properties: {
          providers: { type: "array", maxItems: 32, items: ref("RuntimeMediaProviderCapability") },
        },
      },
      RuntimeMediaProviderCapability: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "model",
          "baseUrl",
          "apiKey",
          "extraBody",
          "contextWindow",
          "maxOutputTokens",
          "pricing",
          "providerKind",
          "isDefault",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          model: { type: "string" },
          baseUrl: { type: "string", format: "uri" },
          apiKey: { type: "string" },
          extraBody: { type: "object", additionalProperties: true },
          contextWindow: { type: "integer", minimum: 0 },
          maxOutputTokens: { type: "integer", minimum: 0 },
          pricing: {
            type: "object",
            nullable: true,
            required: ["currency", "unit", "unitPriceMicros"],
            properties: {
              currency: { type: "string" },
              unit: { type: "string", enum: ["generated_item", "generated_second"] },
              unitPriceMicros: { type: "integer", minimum: 0 },
            },
          },
          providerKind: { type: "string", enum: ["image", "video"] },
          isDefault: { type: "boolean" },
        },
      },
      MemoryDatum: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "content", "confidence"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 32 },
          category: { type: "string", minLength: 1, maxLength: 40 },
          content: { type: "string", minLength: 1, maxLength: 2_000 },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
      FrozenSkillSnapshot: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "description", "body", "files"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 128 },
          name: { type: "string", minLength: 1, maxLength: 128 },
          description: { type: "string", maxLength: 4096 },
          body: { type: "string", minLength: 1, maxLength: 1048576 },
          files: { type: "object", additionalProperties: ref("FrozenSkillFile") },
        },
      },
      FrozenSkillFile: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["storageKind", "mimeType", "content"],
            properties: {
              storageKind: { type: "string", enum: ["inline"] },
              mimeType: { type: "string", nullable: true },
              content: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["storageKind", "mimeType", "assetId", "revisionId", "sizeBytes", "sha256", "url"],
            properties: {
              storageKind: { type: "string", enum: ["asset"] },
              mimeType: { type: "string", nullable: true },
              assetId: { type: "string", minLength: 1 },
              revisionId: { type: "string", minLength: 1 },
              sizeBytes: { type: "integer", minimum: 0 },
              sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
              url: { type: "string", minLength: 1 },
            },
          },
        ],
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
      SessionMessage: {
        type: "object",
        required: ["id", "session_id", "role", "content", "status", "parent_message_id", "branch_index", "created_at"],
        properties: {
          id: { type: "string" },
          session_id: { type: "string" },
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
      SessionDetail: {
        type: "object",
        required: [
          "id",
          "model",
          "provider_id",
          "reasoning_effort",
          "approval_policy",
          "permission_profile",
          "created_at",
          "updated_at",
          "revision",
          "selected_message_id",
          "messages",
          "branches",
          "attachments",
          "active_run_id",
          "latest_run_id",
        ],
        properties: {
          id: { type: "string" },
          model: { type: "string" },
          provider_id: { type: "string" },
          reasoning_effort: ref("ReasoningEffort"),
          approval_policy: ref("ApprovalPolicy"),
          permission_profile: ref("PermissionProfile"),
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          revision: { type: "integer", minimum: 0 },
          selected_message_id: { type: "string", nullable: true },
          messages: { type: "array", items: ref("SessionMessage") },
          branches: { type: "array", items: ref("MessageBranchGroup") },
          attachments: { type: "array", items: ref("SessionFile") },
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
      AgentRunInput: {
        type: "object",
        additionalProperties: false,
        required: ["expected_run_id", "client_message_id", "text", "mode"],
        properties: {
          expected_run_id: { type: "string", minLength: 1, maxLength: 32 },
          client_message_id: {
            type: "string",
            minLength: 8,
            maxLength: 64,
            pattern: "^[a-zA-Z0-9_-]+$",
          },
          text: { type: "string", minLength: 1, maxLength: 64000 },
          mode: { type: "string", enum: ["follow-up", "next-turn"] },
        },
      },
      AgentRunInputStatus: {
        type: "object",
        required: ["clientMessageId", "runId", "mode", "text", "state", "stepNumber", "reason"],
        properties: {
          clientMessageId: { type: "string" },
          runId: { type: "string" },
          mode: { type: "string", enum: ["follow-up", "next-turn"] },
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
      SessionFile: {
        type: "object",
        required: [
          "id",
          "session_id",
          "asset_id",
          "revision_id",
          "title",
          "filename",
          "mime_type",
          "size",
          "sha256",
          "editable",
          "edit_max_bytes",
          "etag",
          "last_writer",
          "created_at",
          "updated_at",
        ],
        properties: {
          id: { type: "string" },
          session_id: { type: "string" },
          asset_id: { type: "string" },
          revision_id: { type: "string" },
          title: { type: "string" },
          filename: { type: "string" },
          mime_type: { type: "string" },
          size: { type: "integer" },
          sha256: { type: "string" },
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
      UpdateSessionFileContentInput: {
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
                            enum: ["system", "tools", "rules", "skills", "mcp", "memory", "session"],
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
      SessionContextCategory: {
        type: "object",
        required: ["id", "tokens"],
        properties: {
          id: {
            type: "string",
            enum: ["system", "tools", "rules", "skills", "mcp", "memory", "session"],
          },
          tokens: { type: "integer" },
        },
      },
      SessionContextView: {
        type: "object",
        required: ["contextWindow", "autoCompactAt", "usedTokens", "estimated", "compacted", "categories"],
        properties: {
          contextWindow: { type: "integer", nullable: true },
          autoCompactAt: { type: "integer", nullable: true },
          usedTokens: { type: "integer" },
          estimated: { type: "boolean" },
          compacted: { type: "boolean" },
          categories: {
            type: "array",
            items: ref("SessionContextCategory"),
          },
        },
      },
      SessionContextResponse: {
        type: "object",
        required: ["context"],
        properties: {
          context: {
            allOf: [ref("SessionContextView")],
            nullable: true,
          },
        },
      },
    },
  },
};

const sessionPaths = Object.fromEntries(
  Object.entries(openapi.paths).map(([path, operation]) => [path.replace(/^\/sessions/, "/v1/sessions"), operation]),
);
process.stdout.write(`${JSON.stringify({ ...openapi, paths: sessionPaths }, null, 2)}\n`);
