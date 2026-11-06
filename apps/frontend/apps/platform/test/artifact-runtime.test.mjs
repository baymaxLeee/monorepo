import { readFileSync } from "node:fs";
import { request } from "node:http";

import { rspack } from "@rspack/core";
import { RspackDevServer } from "@rspack/dev-server";
import { afterAll, beforeAll, expect, test } from "vitest";

import { ARTIFACT_RUNTIME_ASSETS, setupArtifactRuntime } from "../artifact-runtime.config.mjs";

const [{ file: ECHARTS_RUNTIME_FILE, url: ECHARTS_RUNTIME_PATH }] = ARTIFACT_RUNTIME_ASSETS;

const crossSiteHeaders = {
  "Sec-Fetch-Dest": "script",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
};
let server;
let origin;

// Send the browser's Fetch Metadata verbatim; fetch() replaces Sec-Fetch-Mode.
function fetchResource(url, { method = "GET", headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () =>
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })),
      );
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("runtime request timed out")));
    req.end();
  });
}

beforeAll(async () => {
  const compiler = rspack({
    mode: "development",
    entry: {},
    infrastructureLogging: { level: "none" },
    stats: "none",
    plugins: [
      new rspack.CopyRspackPlugin({
        patterns: [{ from: ECHARTS_RUNTIME_FILE, to: ECHARTS_RUNTIME_PATH.slice(1), info: { minimized: true } }],
      }),
    ],
  });
  server = new RspackDevServer(
    {
      host: "127.0.0.1",
      port: 0,
      hot: false,
      client: false,
      webSocketServer: false,
      setupMiddlewares: setupArtifactRuntime,
    },
    compiler,
  );
  await server.start();
  origin = `http://127.0.0.1:${server.server.address().port}`;
});

afterAll(async () => {
  await server?.stop();
});

test("refuses to bypass Host validation when the dev server middleware layout changes", () => {
  expect(() => setupArtifactRuntime([])).toThrow("requires the dev server Host check");
});

test("opaque-origin HTML can load the pinned runtime anonymously with either script request mode", async () => {
  for (const mode of ["no-cors", "cors"]) {
    const response = await fetchResource(`${origin}${ECHARTS_RUNTIME_PATH}`, {
      headers: { ...crossSiteHeaders, "Sec-Fetch-Mode": mode, Origin: "null" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const received = Buffer.from(await response.arrayBuffer());
    // Compare bytes natively; deep equality enumerates a megabyte of Buffer indices.
    expect(received.equals(readFileSync(ECHARTS_RUNTIME_FILE))).toBe(true);
  }
});

test("HEAD serves runtime metadata without a response body", async () => {
  const response = await fetchResource(`${origin}${ECHARTS_RUNTIME_PATH}?cache=1`, {
    method: "HEAD",
    headers: crossSiteHeaders,
  });
  expect(response.status).toBe(200);
  expect(Number(response.headers.get("content-length"))).toBe(readFileSync(ECHARTS_RUNTIME_FILE).length);
  expect(await response.text()).toBe("");
});

test("the public asset does not open private routes, other versions, methods, or untrusted hosts", async () => {
  for (const path of [
    "/main.js",
    "/api/private",
    "/runtime/echarts/other/echarts.min.js",
    `${ECHARTS_RUNTIME_PATH}/extra`,
  ]) {
    const response = await fetchResource(`${origin}${path}`, { headers: crossSiteHeaders });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Cross-Origin request blocked");
  }
  const post = await fetchResource(`${origin}${ECHARTS_RUNTIME_PATH}`, { method: "POST", headers: crossSiteHeaders });
  expect(post.status).toBe(403);
  await post.text();
  const untrustedHost = await fetchResource(`${origin}${ECHARTS_RUNTIME_PATH}`, {
    headers: { ...crossSiteHeaders, Host: "untrusted.invalid" },
  });
  expect(untrustedHost.status).toBe(403);
  expect(await untrustedHost.text()).toBe("Invalid Host header");
});
