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

const htmlArtifactPlanSchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["document", "presentation", "dashboard"] },
    sourceBrief: { type: "string" },
    theme: { type: "object", properties: { visualDirection: { type: "string" }, accent: { type: "string" }, appearance: { type: "string", enum: ["light", "dark"] } }, required: ["visualDirection", "accent", "appearance"] },
    narrative: { type: "string" },
    blocks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, brief: { type: "string" }, layout: { type: "string" }, contentScope: { type: "array", items: { type: "string" } }, acceptanceCriteria: { type: "array", items: { type: "string" } } }, required: ["title", "brief", "layout", "contentScope", "acceptanceCriteria"] } },
  },
  required: ["mode", "sourceBrief", "theme", "narrative", "blocks"],
};

const htmlArtifactTaskPayloadSchema = {
  type: "object",
  properties: {
    orgId: { type: "string" }, userId: { type: "string" }, conversationId: { type: "string" }, providerId: { type: "string" }, title: { type: "string" }, filename: { type: "string" }, plan: htmlArtifactPlanSchema,
    documentId: { type: "string" }, brief: { type: "string" }, blockIds: { type: "array", items: { type: "string" } }, blockBriefs: { type: "object", additionalProperties: { type: "string" } }, expectedObjectSha256: { type: "string" }, idempotencyKey: { type: "string" },
  },
  required: ["orgId", "userId", "providerId", "title", "filename"],
};

const videoGenerationTaskPayloadSchema = {
  type: "object",
  properties: {
    orgId: { type: "string" }, userId: { type: "string" }, conversationId: { type: "string" }, providerId: { type: "string" }, imageProviderId: { type: "string" }, title: { type: "string" }, filename: { type: "string" }, creativeBrief: { type: "string" }, idempotencyKey: { type: "string" },
    plan: { type: "object", properties: {
      targetDurationSec: { type: "integer", minimum: 5, maximum: 120 }, logline: { type: "string" }, motif: { type: "string" }, styleBible: { type: "string" }, settingBible: { type: "string" },
      characters: { type: "array", items: { type: "object", properties: { name: { type: "string" }, appearance: { type: "string" }, documentId: { type: "string" } }, required: ["name", "appearance"] } },
      shots: { type: "array", items: { type: "object", properties: { purpose: { type: "string" }, plot: { type: "string" }, emotion: { type: "string" }, characterNames: { type: "array", items: { type: "string" } }, seconds: { type: "integer", minimum: 4, maximum: 15 }, action: { type: "string" }, camera: { type: "object", properties: { shotSize: { type: "string" }, movement: { type: "string" }, focus: { type: "string" } }, required: ["shotSize", "movement"] }, environment: { type: "string" }, lightingPalette: { type: "string" }, audioDirection: { type: "string" }, continuityContract: { type: "array", items: { type: "string" } }, acceptanceCriteria: { type: "array", items: { type: "string" } } }, required: ["purpose", "plot", "emotion", "characterNames", "seconds", "action", "camera", "environment", "lightingPalette", "audioDirection", "continuityContract", "acceptanceCriteria"] } },
    }, required: ["targetDurationSec", "logline", "motif", "styleBible", "settingBible", "characters", "shots"] },
  },
  required: ["orgId", "userId", "providerId", "title", "filename", "creativeBrief", "plan"],
};

const taskEnvelope = (type: string, payload: object) => ({
  type: "object",
  properties: {
    type: { const: type },
    owner_service: { type: "string", description: "calling service, e.g. chat" },
    owner_ref: { type: "string", description: "idempotency key scoped to owner_service" },
    payload,
  },
  required: ["type", "owner_service", "owner_ref", "payload"],
});

const createTaskInputSchema = {
  oneOf: [
    taskEnvelope("html-artifact", ref("HtmlArtifactTaskPayload")),
    taskEnvelope("video-generation", ref("VideoGenerationTaskPayload")),
  ],
  discriminator: { propertyName: "type" },
};

const referenceAssetSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    mediaType: { type: "string", enum: ["image", "video", "audio"] },
    purpose: { type: "string" },
    documentId: { type: "string" },
    url: { type: "string", format: "uri" },
    licenseStatus: { type: "string", enum: ["verified", "user_attested", "missing"] },
    consentStatus: { type: "string", enum: ["not_applicable", "verified", "user_attested", "missing"] },
  },
  required: ["id", "mediaType", "purpose", "licenseStatus", "consentStatus"],
};

const shotSpecSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    order: { type: "integer" },
    seconds: { type: "integer", minimum: 4, maximum: 15 },
    narrativeBeat: { type: "string" },
    subjectAnchors: { type: "array", items: { type: "string" } },
    action: { type: "string" },
    camera: {
      type: "object",
      properties: {
        shotSize: { type: "string" },
        movement: { type: "string" },
        focus: { type: "string" },
      },
      required: ["shotSize", "movement"],
    },
    environment: { type: "string" },
    lightingPalette: { type: "string" },
    audioDirection: { type: "string" },
    references: { type: "array", items: ref("ReferenceAsset") },
    continuityContract: { type: "array", items: { type: "string" } },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
  },
  required: ["id", "order", "seconds", "narrativeBeat", "subjectAnchors", "action", "camera", "environment", "lightingPalette", "audioDirection", "references", "continuityContract", "acceptanceCriteria"],
};

const shotPlanSchema = {
  type: "object",
  properties: {
    version: { type: "integer" },
    shots: { type: "array", items: ref("ShotSpec") },
  },
  required: ["version", "shots"],
};

const videoTakeSchema = {
  type: "object",
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
  required: ["id", "shotId", "number", "status", "seed"],
};

const videoProductionProjectionSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    taskId: { type: "string" },
    orgId: { type: "string" },
    userId: { type: "string" },
    conversationId: { type: ["string", "null"] },
    title: { type: "string" },
    status: { type: "string", enum: ["running", "awaiting_approval", "completed", "failed", "cancelled"] },
    stage: { type: "string" },
    version: { type: "integer" },
    awaitingAction: { type: ["string", "null"] },
    shotPlan: { type: ["object", "null"], additionalProperties: true },
    shotReviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shotId: { type: "string" },
          selectedTakeId: { type: ["string", "null"] },
          takes: { type: "array", items: ref("VideoTake") },
        },
        required: ["shotId", "selectedTakeId", "takes"],
      },
    },
    cost: { type: "object", additionalProperties: true },
    stagedMediaId: { type: ["string", "null"] },
    documentId: { type: ["string", "null"] },
    qaReport: { type: ["object", "null"], additionalProperties: true },
    error: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "taskId", "orgId", "userId", "title", "status", "stage", "version", "shotReviews", "cost", "createdAt", "updatedAt"],
};

const productionDecisionSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        action: { const: "revise_storyboard" },
        actionId: { type: "string" },
        expectedVersion: { type: "integer" },
        actorId: { type: "string" },
        shotPlan: ref("ShotPlan"),
      },
      required: ["action", "actionId", "expectedVersion", "actorId", "shotPlan"],
    },
    {
      type: "object",
      properties: {
        action: { const: "approve_storyboard" },
        actionId: { type: "string" },
        expectedVersion: { type: "integer" },
        actorId: { type: "string" },
        budgetLimitMicros: { type: "integer", minimum: 0 },
        currency: { type: "string", minLength: 3, maxLength: 3 },
      },
      required: ["action", "actionId", "expectedVersion", "actorId", "budgetLimitMicros", "currency"],
    },
    {
      type: "object",
      properties: {
        action: { const: "request_take" },
        actionId: { type: "string" },
        expectedVersion: { type: "integer" },
        actorId: { type: "string" },
        shotId: { type: "string" },
      },
      required: ["action", "actionId", "expectedVersion", "actorId", "shotId"],
    },
    {
      type: "object",
      properties: {
        action: { const: "approve_takes" },
        actionId: { type: "string" },
        expectedVersion: { type: "integer" },
        actorId: { type: "string" },
        selections: {
          type: "array",
          items: {
            type: "object",
            properties: { shotId: { type: "string" }, takeId: { type: "string" } },
            required: ["shotId", "takeId"],
          },
        },
      },
      required: ["action", "actionId", "expectedVersion", "actorId", "selections"],
    },
    {
      type: "object",
      properties: {
        action: { const: "reject_storyboard" },
        actionId: { type: "string" },
        expectedVersion: { type: "integer" },
        actorId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["action", "actionId", "expectedVersion", "actorId", "reason"],
    },
    {
      type: "object",
      properties: {
        action: { enum: ["approve_publish"] },
        actionId: { type: "string" },
        expectedVersion: { type: "integer" },
        actorId: { type: "string" },
        waiverReason: { type: "string", minLength: 1, maxLength: 1000 },
      },
      required: ["action", "actionId", "expectedVersion", "actorId"],
    },
    {
      type: "object",
      properties: {
        action: { enum: ["reject_publish"] },
        actionId: { type: "string" },
        expectedVersion: { type: "integer" },
        actorId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["action", "actionId", "expectedVersion", "actorId", "reason"],
    },
  ],
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
    "/video-productions/{id}": {
      get: {
        parameters: [idPathParam],
        responses: {
          "200": jsonResponse("video production projection and event log", {
            type: "object",
            properties: {
              production: ref("VideoProductionProjection"),
              events: { type: "array", items: { type: "object", additionalProperties: true } },
            },
            required: ["production", "events"],
          }),
          "404": { description: "video production not found" },
        },
      },
    },
    "/video-productions/{id}/decisions": {
      post: {
        parameters: [idPathParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: productionDecisionSchema } },
        },
        responses: {
          "200": jsonResponse("updated video production projection", ref("VideoProductionProjection")),
          "409": { description: "stale production version or unavailable decision" },
        },
      },
    },
  },
  components: {
    schemas: {
      Task: taskSchema,
      CreateTaskInput: createTaskInputSchema,
      HtmlArtifactTaskPayload: htmlArtifactTaskPayloadSchema,
      VideoGenerationTaskPayload: videoGenerationTaskPayloadSchema,
      ReferenceAsset: referenceAssetSchema,
      ShotSpec: shotSpecSchema,
      ShotPlan: shotPlanSchema,
      VideoTake: videoTakeSchema,
      VideoProductionProjection: videoProductionProjectionSchema,
      ProductionDecision: productionDecisionSchema,
    },
    securitySchemes: {
      internalToken: { type: "apiKey", in: "header", name: "X-Internal-Token" },
    },
  },
  security: [{ internalToken: [] }],
};

process.stdout.write(`${JSON.stringify(openapi, null, 2)}\n`);
