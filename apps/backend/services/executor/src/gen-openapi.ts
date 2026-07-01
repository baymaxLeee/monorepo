const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonResponse = (description: string, schema: object) => ({
  description,
  content: { "application/json": { schema } },
});

const idPathParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    status: {
      type: "string",
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    },
    ownerService: { type: "string" },
    ownerRef: { type: "string" },
    result: {},
    error: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    finishedAt: { type: "string", format: "date-time", nullable: true },
  },
  required: [
    "id",
    "type",
    "status",
    "ownerService",
    "ownerRef",
    "result",
    "error",
    "createdAt",
    "updatedAt",
    "finishedAt",
  ],
};

const createTaskInputSchema = {
  type: "object",
  properties: {
    type: { type: "string", description: "registered TaskType name, e.g. html-artifact" },
    owner_service: { type: "string", description: "calling service, e.g. chat" },
    owner_ref: {
      type: "string",
      description: "idempotency key scoped to owner_service, e.g. a tool call id",
    },
    payload: {
      description: "TaskType-specific input, validated against that type's schema",
    },
  },
  required: ["type", "owner_service", "owner_ref", "payload"],
};

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Executor Service",
    version: "0.1.0",
    description:
      "Durable task executor (Brain=chat's ToolLoopAgent, Hands+Session=this service). See docs/ADR and apps/backend/services/executor/AGENTS.md.",
  },
  paths: {
    "/healthz": { get: { responses: { "200": { description: "ok" } } } },
    "/tasks": {
      post: {
        summary: "Start a durable task. Non-blocking: returns immediately with status=queued/running.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: createTaskInputSchema } },
        },
        responses: {
          "201": jsonResponse("task created (or existing task if owner_ref already used)", taskSchema),
          "400": { description: "unknown task type or invalid payload" },
        },
      },
    },
    "/tasks/{id}": {
      get: {
        parameters: [idPathParam],
        responses: {
          "200": jsonResponse("task snapshot", taskSchema),
          "404": { description: "task not found" },
        },
      },
    },
    "/tasks/{id}/cancel": {
      post: {
        parameters: [idPathParam],
        responses: {
          "200": jsonResponse("task snapshot after cancellation request", taskSchema),
          "404": { description: "task not found" },
        },
      },
    },
  },
  components: {
    schemas: {
      Task: taskSchema,
      CreateTaskInput: createTaskInputSchema,
    },
    securitySchemes: {
      internalToken: { type: "apiKey", in: "header", name: "X-Internal-Token" },
    },
  },
  security: [{ internalToken: [] }],
};

process.stdout.write(`${JSON.stringify(openapi, null, 2)}\n`);
