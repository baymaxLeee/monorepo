const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: object) => ({ oneOf: [schema, { type: "null" }] });
const jsonResponse = (description: string, schema: object) => ({
  description,
  content: { "application/json": { schema } },
});

const idPathParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const ownerParameters = [
  idPathParam,
  { name: "owner_service", in: "query", required: true, schema: { type: "string" } },
  { name: "owner_ref", in: "query", required: true, schema: { type: "string" } },
];

const providerCapabilitySchema = {
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
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    baseUrl: { type: "string", format: "uri" },
    apiKey: { type: "string", minLength: 1, writeOnly: true },
    extraBody: { type: "object", additionalProperties: true },
    contextWindow: { type: "integer", minimum: 0 },
    maxOutputTokens: { type: "integer", minimum: 0 },
    pricing: nullable({
      type: "object",
      additionalProperties: false,
      required: ["currency", "unit", "unitPriceMicros"],
      properties: {
        currency: { type: "string", minLength: 1 },
        unit: { type: "string", enum: ["generated_item", "generated_second"] },
        unitPriceMicros: { type: "integer", minimum: 0 },
      },
    }),
    providerKind: { type: "string", enum: ["image", "video"] },
    isDefault: { type: "boolean" },
  },
};

const imageReferenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assetId", "revisionId", "mediaType"],
  properties: {
    assetId: { type: "string", format: "uuid" },
    revisionId: { type: "string", format: "uuid" },
    mediaType: { type: "string", pattern: "^image/" },
  },
};

const videoReferenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assetId", "revisionId"],
  properties: {
    assetId: { type: "string", format: "uuid" },
    revisionId: { type: "string", format: "uuid" },
  },
};

const imageGenerationTaskPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provider", "prompts", "references", "idempotencyKey"],
  properties: {
    sessionId: { type: "string" },
    provider: ref("ProviderCapability"),
    prompts: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 4_000 },
    },
    references: { type: "array", maxItems: 5, items: ref("ImageReference") },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 120 },
  },
};

const videoGenerationTaskPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provider", "prompt", "references", "filename", "idempotencyKey"],
  properties: {
    sessionId: { type: "string" },
    provider: ref("ProviderCapability"),
    prompt: { type: "string", minLength: 1, maxLength: 4_000 },
    references: { type: "array", maxItems: 5, items: ref("VideoReference") },
    durationSeconds: { type: "integer", minimum: 4, maximum: 15 },
    filename: { type: "string", minLength: 1, maxLength: 160 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 120 },
  },
};

const taskEnvelope = (type: "image-generation" | "video-generation", payload: object) => ({
  type: "object",
  additionalProperties: false,
  required: ["type", "owner_service", "owner_ref", "payload"],
  properties: {
    type: { const: type },
    owner_service: { type: "string", minLength: 1, maxLength: 40, description: "authenticated workload caller" },
    owner_ref: { type: "string", minLength: 1, maxLength: 80, description: "caller-stable idempotency reference" },
    payload,
  },
});

const taskSchema = {
  type: "object",
  additionalProperties: false,
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
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: ["image-generation", "video-generation"] },
    status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
    ownerService: { type: "string" },
    ownerRef: { type: "string" },
    result: {},
    progress: nullable({
      type: "object",
      additionalProperties: false,
      required: ["done", "total"],
      properties: {
        done: { type: "integer" },
        total: { type: "integer" },
        externalTaskIds: { type: "array", items: { type: "string" } },
        text: { type: "string" },
      },
    }),
    error: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    finishedAt: { type: ["string", "null"], format: "date-time" },
  },
};

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Runtime Worker",
    version: "1.0.0",
    description: "Tenant-neutral durable execution used transparently by blocking Runtime tools.",
  },
  paths: {
    "/healthz": { get: { responses: { "200": { description: "ok" } } } },
    "/tasks": {
      post: {
        summary: "Idempotently admit an internal durable Runtime task.",
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateTaskInput") } } },
        responses: {
          "201": jsonResponse("task created or existing equivalent task", ref("Task")),
          "400": { description: "unknown task type or invalid payload" },
          "409": { description: "owner_ref was reused with different input" },
        },
      },
    },
    "/tasks/{id}": {
      get: {
        parameters: ownerParameters,
        responses: {
          "200": jsonResponse("task snapshot", ref("Task")),
          "404": { description: "task not found" },
        },
      },
    },
    "/tasks/{id}/stream": {
      get: {
        summary: "Watch authoritative task snapshots over internal SSE.",
        parameters: ownerParameters,
        responses: {
          "200": {
            description: "snapshot events containing a generic task JSON object",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          "404": { description: "task not found" },
        },
      },
    },
    "/tasks/cancel-by-owner": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["owner_service", "owner_ref", "type"],
                properties: {
                  owner_service: { type: "string" },
                  owner_ref: { type: "string" },
                  type: { type: "string", enum: ["image-generation", "video-generation"] },
                },
              },
            },
          },
        },
        responses: { "200": jsonResponse("task snapshot after cancellation", ref("Task")) },
      },
    },
    "/tasks/{id}/cancel": {
      post: {
        parameters: ownerParameters,
        responses: {
          "200": jsonResponse("task snapshot after cancellation", ref("Task")),
          "404": { description: "task not found" },
        },
      },
    },
  },
  components: {
    schemas: {
      ProviderCapability: providerCapabilitySchema,
      ImageReference: imageReferenceSchema,
      VideoReference: videoReferenceSchema,
      ImageGenerationTaskPayload: imageGenerationTaskPayloadSchema,
      VideoGenerationTaskPayload: videoGenerationTaskPayloadSchema,
      CreateTaskInput: {
        oneOf: [
          taskEnvelope("image-generation", ref("ImageGenerationTaskPayload")),
          taskEnvelope("video-generation", ref("VideoGenerationTaskPayload")),
        ],
        discriminator: { propertyName: "type" },
      },
      Task: taskSchema,
      TaskWatchFrame: {
        type: "object",
        additionalProperties: false,
        required: ["task"],
        properties: { task: ref("Task") },
      },
    },
    securitySchemes: { internalToken: { type: "apiKey", in: "header", name: "X-Internal-Token" } },
  },
  security: [{ internalToken: [] }],
};

process.stdout.write(`${JSON.stringify(openapi, null, 2)}\n`);
