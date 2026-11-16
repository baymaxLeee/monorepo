try {
  process.loadEnvFile(".env.worker");
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
let runtimePromise: Promise<WorkflowHandlerModule> | undefined;

function loadRuntime() {
  runtimePromise ??= importHandler("workflows");
  return runtimePromise;
}
const [{ default: workerApp }, { getWorkerSettings }, { logger }] = await Promise.all([
  import("./app.js"),
  import("../../bootstrap/worker-config.js"),
  import("../../infrastructure/observability/worker-logger.js"),
]);

const app = new Hono();
app.all("/.well-known/workflow/v1/flow", async (c) => {
  const handler = (await loadRuntime())[c.req.method];
  return handler ? handler(c.req.raw) : c.body(null, 405);
});
app.all("/.well-known/workflow/v1/webhook/:token", async (c) => {
  const webhook = await importHandler("webhook");
  const handler = webhook[c.req.method];
  return handler ? handler(c.req.raw) : c.body(null, 405);
});
app.route("/", workerApp);

const { port } = getWorkerSettings();
serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port, workflowWatch: false }, "listening");
});
