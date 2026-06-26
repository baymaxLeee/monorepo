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

const startIndexQueryParam = {
  name: "startIndex",
  in: "query",
  required: false,
  schema: { type: "integer" },
};

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
  },
};

process.stdout.write(`${JSON.stringify(openapi, null, 2)}\n`);
