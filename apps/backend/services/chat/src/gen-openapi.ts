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

const workflowRunPathParam = {
  name: "workflow_run_id",
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

const startIndexQueryParam = {
  name: "startIndex",
  in: "query",
  required: false,
  schema: { type: "integer" },
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
      post: {
        parameters: [pathParam],
        responses: {
          "200": {
            description: "start WorkflowAgent run stream",
            headers: {
              "x-workflow-run-id": {
                description: "Workflow run id used for stream resume/cancel",
                schema: { type: "string" },
              },
            },
          },
        },
      },
    },
    "/conversations/{conversation_id}/agents/run/stream/{workflow_run_id}/stream": {
      get: {
        parameters: [pathParam, workflowRunPathParam, startIndexQueryParam],
        responses: { "200": { description: "resume WorkflowAgent run stream" } },
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
    "/conversations/{conversation_id}/agents/run/cancel": {
      post: {
        parameters: [pathParam],
        responses: { "200": { description: "cancel active agent run" } },
      },
    },
    "/conversations/{conversation_id}/agents/run/stream/{workflow_run_id}/resume": {
      post: {
        parameters: [pathParam, workflowRunPathParam],
        responses: { "200": { description: "resume a suspended ask_user hook" } },
      },
    },
    "/conversations/{conversation_id}/agents/run/stream/{workflow_run_id}/trace": {
      get: {
        parameters: [pathParam, workflowRunPathParam],
        responses: { "200": { description: "agent run step/tool-call trace" } },
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
