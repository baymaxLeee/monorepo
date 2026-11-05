import { z } from "zod";

import { continueSchema, processSchema, scopeSchema, sessionSchema, startSchema } from "./contracts.js";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ description: "success", content: { "application/json": { schema } } });
const body = (name: string) => ({ required: true, content: { "application/json": { schema: ref(name) } } });
const id = { name: "id", in: "path", required: true, schema: { type: "string" } };
const scope = {
  name: "X-Sandbox-Scope",
  in: "header",
  required: true,
  schema: { type: "string" },
  description: "JSON-encoded SandboxScope",
};
const fileParams = [id, scope, { name: "path", in: "query", required: true, schema: { type: "string" } }];
const schemas = {
  SandboxScope: scopeSchema,
  SandboxStart: startSchema,
  SandboxContinue: continueSchema,
  SandboxProcess: processSchema,
  SandboxSession: sessionSchema,
};
process.stdout.write(
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: { title: "Sandbox", version: "1.0.0" },
      paths: {
        "/sessions": {
          post: { requestBody: body("SandboxScope"), responses: { "201": json(ref("SandboxSession")) } },
          delete: {
            parameters: [scope],
            responses: {
              "200": json({ type: "object", properties: { destroyed: { type: "boolean" } }, required: ["destroyed"] }),
            },
          },
        },
        "/sessions/{id}/commands": {
          post: {
            parameters: [id],
            requestBody: body("SandboxStart"),
            responses: { "200": json(ref("SandboxProcess")) },
          },
        },
        "/sessions/{id}/processes/{processId}": {
          post: {
            parameters: [id, { ...id, name: "processId" }],
            requestBody: body("SandboxContinue"),
            responses: { "200": json(ref("SandboxProcess")) },
          },
        },
        "/sessions/{id}": {
          delete: {
            parameters: [id, scope],
            responses: {
              "200": json({ type: "object", properties: { destroyed: { type: "boolean" } }, required: ["destroyed"] }),
            },
          },
        },
        "/sessions/{id}/files": {
          put: {
            parameters: fileParams,
            requestBody: {
              required: true,
              content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
            },
            responses: {
              "200": json({ type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"] }),
            },
          },
          get: {
            parameters: fileParams,
            responses: {
              "200": {
                description: "original file bytes",
                content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
              },
            },
          },
        },
      },
      components: {
        schemas: Object.fromEntries(
          Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: "input" })]),
        ),
        securitySchemes: { internalToken: { type: "apiKey", in: "header", name: "X-Internal-Token" } },
      },
      security: [{ internalToken: [] }],
    },
    null,
    2,
  ) + "\n",
);
