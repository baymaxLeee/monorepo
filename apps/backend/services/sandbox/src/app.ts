import { timingSafeEqual } from "node:crypto";

import { createLogger, traceMiddleware, requestLogger } from "@backend/kernel-ts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { Settings } from "./config.js";
import { continueSchema, scopeSchema, startSchema, workspaceEditSchema } from "./contracts.js";
import { Engine, resourceName } from "./engine.js";

export function createApp(config: Settings, engine = new Engine(config)) {
  const app = new Hono();
  const logger = createLogger({ service: "sandbox" });
  let active = 0;
  let requests = 0;
  let failures = 0;
  let duration = 0;
  let readyUntil = 0;
  let readiness: Promise<void> | undefined;
  app.use("*", traceMiddleware(), requestLogger(logger));
  app.get("/livez", (c) => c.json({ status: "ok" }));
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    try {
      if (!readiness || Date.now() >= readyUntil) {
        readyUntil = Date.now() + 5000;
        readiness = engine.ready();
      }
      await readiness;
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });
  app.get("/metrics", (c) =>
    c.text(
      `sandbox_requests_total ${requests}\nsandbox_request_failures_total ${failures}\nsandbox_active_requests ${active}\nsandbox_request_duration_seconds_sum ${duration}\nsandbox_request_duration_seconds_count ${requests}\n`,
    ),
  );
  app.use("/sessions/*", async (c, next) => {
    const actual = Buffer.from(c.req.header("X-Internal-Token") ?? "");
    const expected = Buffer.from(config.chatToken);
    if (
      c.req.header("X-Caller-Service") !== "chat" ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return c.json({ message: "invalid caller credentials" }, 401);
    }
    await next();
  });
  app.use("/sessions/*", async (c, next) => {
    if (active >= config.maxRequests) {
      c.header("Retry-After", "1");
      return c.json({ message: "sandbox controller is at capacity" }, 503);
    }
    active++;
    requests++;
    const start = performance.now();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
        duration += (performance.now() - start) / 1000;
      }
    };
    try {
      if (c.req.method === "POST") await bodyLimit({ maxSize: 1048576 })(c, next);
      else await next();
      if (c.res.status >= 400) failures++;
      if (c.req.method === "GET" && c.req.path.endsWith("/files") && c.res.body) {
        const reader = c.res.body.getReader();
        const body = new ReadableStream({
          async pull(controller) {
            try {
              const result = await reader.read();
              if (result.done) {
                release();
                controller.close();
              } else controller.enqueue(result.value);
            } catch (error) {
              failures++;
              release();
              controller.error(error);
            }
          },
          async cancel(reason) {
            release();
            await reader.cancel(reason);
          },
        });
        c.res = new Response(body, { status: c.res.status, headers: c.res.headers });
      } else release();
    } catch (error) {
      failures++;
      release();
      throw error;
    }
  });
  app.post("/sessions", async (c) => {
    const scope = scopeSchema.parse(await c.req.json());
    return c.json(await engine.create(scope, c.req.raw.signal), 201);
  });
  app.delete("/sessions", async (c) => {
    const scope = scopeSchema.parse(JSON.parse(c.req.header("X-Sandbox-Scope") ?? "null"));
    await engine.destroy(resourceName(scope), scope);
    return c.json({ destroyed: true });
  });
  app.post("/sessions/:id/commands", async (c) => {
    const { scope, ...input } = startSchema.parse(await c.req.json());
    if (input.timeout_ms > config.commandTimeoutMs)
      return c.json({ message: "command timeout exceeds configured maximum" }, 400);
    return c.json(await engine.process(c.req.param("id"), scope, { ...input, op: "start" }));
  });
  app.post("/sessions/:id/processes/:processId", async (c) => {
    const { scope, ...input } = continueSchema.parse(await c.req.json());
    return c.json(
      await engine.process(c.req.param("id"), scope, {
        ...input,
        op: input.chars ? "write" : "poll",
        session_id: c.req.param("processId"),
      }),
    );
  });
  app.delete("/sessions/:id/processes/:processId", async (c) => {
    const scope = scopeSchema.parse(JSON.parse(c.req.header("X-Sandbox-Scope") ?? "null"));
    return c.json(
      await engine.process(c.req.param("id"), scope, {
        op: "cancel",
        session_id: c.req.param("processId"),
        stdout_offset: 0,
        stderr_offset: 0,
        yield_time_ms: 0,
      }),
    );
  });
  const headerScope = (value: string | undefined) => scopeSchema.parse(JSON.parse(value ?? "null"));
  app.put("/sessions/:id/files", async (c) => {
    const scope = headerScope(c.req.header("X-Sandbox-Scope"));
    if (!c.req.raw.body) return c.json({ message: "file body required" }, 400);
    await engine.upload(
      c.req.param("id"),
      scope,
      c.req.query("path") ?? "",
      c.req.raw.body,
      AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(config.ttlSeconds * 1000)]),
      c.req.header("X-Sandbox-Workspace-Edit") || undefined,
    );
    return c.json({ saved: true });
  });
  app.get("/sessions/:id/files", async (c) => {
    const scope = headerScope(c.req.header("X-Sandbox-Scope"));
    const result = await engine.download(
      c.req.param("id"),
      scope,
      c.req.query("path") ?? "",
      AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(config.ttlSeconds * 1000)]),
    );
    return new Response(result.body, { headers: { "Content-Type": "application/octet-stream" } });
  });
  app.post("/sessions/:id/snapshot", async (c) => {
    const scope = headerScope(c.req.header("X-Sandbox-Scope"));
    return c.json(await engine.snapshot(c.req.param("id"), scope));
  });
  app.post("/sessions/:id/workspace-edits", async (c) => {
    const scope = headerScope(c.req.header("X-Sandbox-Scope"));
    const token = c.req.header("X-Sandbox-Workspace-Edit") || undefined;
    return c.json(await engine.acquireWorkspaceEdit(c.req.param("id"), scope, token), 201);
  });
  app.delete("/sessions/:id/workspace-edits", async (c) => {
    const scope = headerScope(c.req.header("X-Sandbox-Scope"));
    const { token } = workspaceEditSchema.parse(await c.req.json());
    return c.json(await engine.releaseWorkspaceEdit(c.req.param("id"), scope, token));
  });
  app.delete("/sessions/:id", async (c) => {
    await engine.destroy(c.req.param("id"), headerScope(c.req.header("X-Sandbox-Scope")));
    return c.json({ destroyed: true });
  });
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return c.json({ message: invalid ? "invalid sandbox request" : error.message }, invalid ? 400 : 422);
  });
  return app;
}
