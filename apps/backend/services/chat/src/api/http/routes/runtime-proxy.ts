import { Hono } from "hono";

import { proxyRuntimeRequest } from "../../../application/runtime-proxy.js";

const memoriesRoutes = new Hono();
memoriesRoutes.all("/", async (c) => proxyRuntimeRequest(c.req.raw));
memoriesRoutes.all("/*", async (c) => proxyRuntimeRequest(c.req.raw));

const localInferenceRoutes = new Hono();
localInferenceRoutes.all("/*", async (c) => proxyRuntimeRequest(c.req.raw));

export { localInferenceRoutes, memoriesRoutes };
