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
    progress: {
      type: "object",
      nullable: true,
      properties: {
        done: { type: "integer" },
        total: { type: "integer" },
      },
      required: ["done", "total"],
    },
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
    "progress",
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

const htmlValidationFindingSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
    severity: { type: "string", enum: ["error", "warning", "info"] },
    category: { type: "string", enum: ["structure", "security", "template", "responsive", "accessibility", "navigation", "chart"] },
    message: { type: "string" },
    suggestion: { type: "string" },
    block_id: { type: "string" },
    selector: { type: "string" },
    evidence: {
      type: "object",
      properties: { kind: { type: "string", enum: ["html", "css"] }, excerpt: { type: "string" } },
      required: ["kind", "excerpt"],
    },
  },
  required: ["code", "severity", "category", "message", "suggestion"],
};

const htmlValidationReportSchema = {
  type: "object",
  properties: {
    schema_version: { type: "integer", enum: [1] },
    template_version: { type: "integer" },
    ok: { type: "boolean" },
    content_sha256: { type: "string" },
    summary: {
      type: "object",
      properties: { errors: { type: "integer" }, warnings: { type: "integer" }, infos: { type: "integer" } },
      required: ["errors", "warnings", "infos"],
    },
    findings: { type: "array", items: ref("HtmlValidationFinding") },
    metrics: {
      type: "object",
      properties: {
        blocks: { type: "integer" },
        charts: { type: "integer" },
        internal_links: { type: "integer" },
        total_chars: { type: "integer" },
      },
      required: ["blocks", "charts", "internal_links", "total_chars"],
    },
  },
  required: ["schema_version", "template_version", "ok", "content_sha256", "summary", "findings", "metrics"],
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
    "/html-validations": {
      post: {
        summary: "Validate current compiled artifact HTML synchronously.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { user_id: { type: "string" }, document_id: { type: "string" } },
                required: ["user_id", "document_id"],
              },
            },
          },
        },
        responses: { "200": jsonResponse("canonical HTML validation report", ref("HtmlValidationReport")) },
      },
    },
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
        parameters: [
          idPathParam,
          {
            name: "owner_service",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "owner_ref",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": jsonResponse("task snapshot", taskSchema),
          "404": { description: "task not found" },
        },
      },
    },
    "/tasks/{id}/cancel": {
      post: {
        parameters: [
          idPathParam,
          {
            name: "owner_service",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "owner_ref",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
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
      HtmlValidationFinding: htmlValidationFindingSchema,
      HtmlValidationReport: htmlValidationReportSchema,
    },
    securitySchemes: {
      internalToken: { type: "apiKey", in: "header", name: "X-Internal-Token" },
    },
  },
  security: [{ internalToken: [] }],
};

process.stdout.write(`${JSON.stringify(openapi, null, 2)}\n`);
