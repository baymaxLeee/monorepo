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

const runPathParam = {
  name: "run_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const memoryIdPathParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const taskPathParam = {
  name: "task_id",
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
  openapi: "3.1.0",
  info: { title: "Chat Service", version: "0.1.0", description: "对话 / Agent 微服务 (TypeScript)" },
  paths: {
    "/healthz": { get: { responses: { "200": { description: "ok" } } } },
    "/conversations": {
      get: { responses: { "200": { description: "list conversations" } } },
      post: { responses: { "201": { description: "create conversation" } } },
    },
    "/conversations/{conversation_id}": {
      get: {
        parameters: [pathParam],
        responses: { "200": { description: "conversation detail" } },
      },
      patch: {
        parameters: [pathParam],
        responses: { "200": { description: "update conversation" } },
      },
      delete: {
        parameters: [pathParam],
        responses: { "204": { description: "delete conversation" } },
      },
    },
    "/conversations/{conversation_id}/agents/run/stream": {
      get: {
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
        parameters: [pathParam],
        responses: {
          "200": {
            description: "start ToolLoopAgent UI message stream",
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
        parameters: [pathParam, documentPathParam],
        responses: { "200": { description: "conversation document detail" } },
      },
      patch: {
        parameters: [pathParam, documentPathParam],
        responses: { "200": { description: "update conversation artifact" } },
      },
    },
    "/conversations/{conversation_id}/documents/{document_id}/source": {
      get: {
        parameters: [pathParam, documentPathParam],
        responses: { "200": { description: "conversation document source bytes" } },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/trace": {
      get: {
        parameters: [pathParam, runPathParam],
        responses: { "200": { description: "agent run step/tool-call trace" } },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/cancel": {
      post: {
        parameters: [pathParam, runPathParam],
        responses: { "200": jsonResponse("request agent run cancellation", ref("RunCancellation")) },
      },
    },
    "/conversations/{conversation_id}/tasks/{task_id}": {
      get: {
        summary: "Proxy to the executor service's task status (see write_file/edit_file tool output task_id).",
        parameters: [pathParam, taskPathParam],
        responses: {
          "200": jsonResponse("task snapshot", ref("Task")),
          "404": { description: "task not found" },
        },
      },
    },
    "/memories": {
      get: {
        responses: {
          "200": jsonResponse("list active user memories", ref("UserMemoryList")),
        },
      },
    },
    "/memories/candidates": {
      get: {
        responses: {
          "200": jsonResponse("list pending memory candidates", ref("MemoryCandidateList")),
        },
      },
    },
    "/memories/candidates/{id}/approve": {
      post: {
        parameters: [memoryIdPathParam],
        responses: {
          "200": jsonResponse(
            "approve a memory candidate into active memory",
            ref("ApprovedMemory"),
          ),
        },
      },
    },
    "/memories/candidates/{id}/reject": {
      post: {
        parameters: [memoryIdPathParam],
        responses: {
          "200": jsonResponse("reject a memory candidate", ref("RejectedMemory")),
        },
      },
    },
    "/memories/candidates/{id}": {
      patch: {
        parameters: [memoryIdPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateMemoryCandidate") } },
        },
        responses: {
          "200": jsonResponse(
            "edit a pending memory candidate before approval",
            ref("UpdatedMemoryCandidate"),
          ),
        },
      },
    },
    "/memories/{id}": {
      delete: {
        parameters: [memoryIdPathParam],
        responses: {
          "200": jsonResponse("delete (deactivate) a stored memory", ref("DeletedMemory")),
        },
      },
    },
  },
  components: {
    schemas: {
      RunCancellation: {
        type: "object",
        required: ["cancelled"],
        properties: {
          cancelled: { type: "boolean" },
          status: { type: "string" },
        },
      },
      Task: {
        type: "object",
        required: [
          "id", "type", "status", "ownerService", "ownerRef", "result", "error",
          "createdAt", "updatedAt", "finishedAt",
        ],
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
          ownerService: { type: "string" },
          ownerRef: { type: "string" },
          result: {},
          error: { type: ["string", "null"] },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
          finishedAt: { type: ["string", "null"] },
        },
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
          reason: { type: ["string", "null"] },
          supersedesId: { type: ["string", "null"] },
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
