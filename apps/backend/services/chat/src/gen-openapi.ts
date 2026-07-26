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

const filePathQuery = {
  name: "path",
  in: "query",
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
    "/conversations/{conversation_id}/context": {
      get: {
        parameters: [pathParam],
        responses: {
          "200": jsonResponse("conversation context snapshot", ref("ConversationContextResponse")),
        },
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
    "/conversations/{conversation_id}/files/detail": {
      get: {
        parameters: [pathParam, filePathQuery],
        responses: {
          "200": jsonResponse("conversation virtual file detail", ref("ConversationFile")),
          "404": { description: "file not found" },
        },
      },
    },
    "/conversations/{conversation_id}/agents/runs/{run_id}/trace": {
      get: {
        parameters: [pathParam, runPathParam],
        responses: {
          "200": jsonResponse("agent run step/tool-call trace", ref("AgentRunTrace")),
        },
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
        summary: "Proxy to the executor service's task status (see delegate_tasks tool output task_id).",
        parameters: [pathParam, taskPathParam],
        responses: {
          "200": jsonResponse("task snapshot", ref("Task")),
          "404": { description: "task not found" },
        },
      },
    },
    "/conversations/{conversation_id}/video-productions/{production_id}": {
      get: {
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
    "/conversations/{conversation_id}/video-productions/{production_id}/preview": {
      get: {
        parameters: [pathParam, productionPathParam],
        responses: {
          "200": {
            description: "staged video preview",
            content: { "video/mp4": { schema: { type: "string", format: "binary" } } },
          },
          "404": { description: "preview not available" },
        },
      },
    },
    "/conversations/{conversation_id}/video-productions/{production_id}/shots/{shot_id}/takes/{take_id}/preview": {
      get: {
        parameters: [pathParam, productionPathParam, shotPathParam, takePathParam],
        responses: {
          "200": {
            description: "staged video take preview",
            content: { "video/mp4": { schema: { type: "string", format: "binary" } } },
          },
          "404": { description: "take preview not available" },
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
          "200": jsonResponse("approve a memory candidate into active memory", ref("ApprovedMemory")),
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
          "200": jsonResponse("edit a pending memory candidate before approval", ref("UpdatedMemoryCandidate")),
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
      ConversationFile: {
        type: "object",
        required: ["path", "title", "filename", "mime_type", "size", "sha256", "writable", "derived", "content"],
        properties: {
          path: { type: "string" },
          title: { type: "string" },
          filename: { type: "string" },
          mime_type: { type: "string" },
          size: { type: "integer", nullable: true },
          sha256: { type: "string" },
          writable: { type: "boolean" },
          derived: { type: "boolean" },
          content: { type: "string", nullable: true },
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
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
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
      Task: {
        type: "object",
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
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
          ownerService: { type: "string" },
          ownerRef: { type: "string" },
          result: { type: "object", nullable: true, additionalProperties: true },
          error: { type: "string", nullable: true },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
          finishedAt: { type: "string", nullable: true },
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
          "orgId",
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
          orgId: { type: "string" },
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
