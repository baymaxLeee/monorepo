try {
  process.loadEnvFile();
} catch {}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

type WorkflowHandler = (request: Request) => Response | Promise<Response>;
type WorkflowHandlerModule = Readonly<Record<string, WorkflowHandler | undefined>>;

const workflowOutput = resolve("node_modules/.workflow-dev");
const importHandler = (name: string) =>
  import(pathToFileURL(resolve(workflowOutput, `${name}.mjs`)).href) as Promise<WorkflowHandlerModule>;
let runtimePromise: Promise<{ flow: WorkflowHandlerModule; step: WorkflowHandlerModule }> | undefined;

function loadRuntime() {
  runtimePromise ??= importHandler("steps").then(async (step) => ({ step, flow: await importHandler("workflows") }));
  return runtimePromise;
}
const [{ default: executorApp }, { getSettings }, { logger }] = await Promise.all([
  import("./index.js"),
  import("./bootstrap/config.js"),
  import("./infrastructure/observability/logger.js"),
]);

const app = new Hono();
app.all("/.well-known/workflow/v1/flow", async (c) => {
  const handler = (await loadRuntime()).flow[c.req.method];
  return handler ? handler(c.req.raw) : c.body(null, 405);
});
app.all("/.well-known/workflow/v1/step", async (c) => {
  const handler = (await loadRuntime()).step[c.req.method];
  return handler ? handler(c.req.raw) : c.body(null, 405);
});
app.all("/.well-known/workflow/v1/webhook/:token", async (c) => {
  const webhook = await importHandler("webhook");
  const handler = webhook[c.req.method];
  return handler ? handler(c.req.raw) : c.body(null, 405);
});
app.route("/", executorApp);

const { port } = getSettings();
serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port, workflowWatch: false }, "listening");
});
