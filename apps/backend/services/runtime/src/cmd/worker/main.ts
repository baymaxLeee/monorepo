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
const [{ prepareWorkerEnvironment }, { logger }] = await Promise.all([
  import("../../config/worker.js"),
  import("../../infrastructure/observability/worker-logger.js"),
]);
const settings = prepareWorkerEnvironment();
const [{ default: workerApp }, { workerShutdown }] = await Promise.all([
  import("./app.js"),
  import("../../bootstrap/worker-runtime.js"),
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

const server = serve({ fetch: app.fetch, port: settings.port }, (info) => {
  logger.info({ port: info.port, workflowWatch: false }, "listening");
});

const closeHttp = () =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
const shutdown = workerShutdown(closeHttp);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(
      () => process.exit(0),
      (error) => {
        logger.error({ err: error, signal }, "runtime worker shutdown failed");
        process.exit(1);
      },
    );
  });
}
