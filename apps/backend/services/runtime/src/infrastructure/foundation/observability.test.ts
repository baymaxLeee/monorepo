import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { agentModelTelemetry, configureOpenTelemetry, shutdownOpenTelemetry } from "./observability.js";

test("the configured collector receives AI SDK spans without model input or output content", async (t) => {
  const batches: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    batches.push(Buffer.concat(chunks).toString());
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const initialEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  t.after(async () => {
    await shutdownOpenTelemetry();
    if (initialEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = initialEndpoint;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });
  assert.equal(agentModelTelemetry(), undefined);
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${address.port}/v1/traces`;
  configureOpenTelemetry("runtime-test");
  await generateText({
    telemetry: agentModelTelemetry(),
    model: new MockLanguageModelV4({
      provider: "local-test-provider",
      modelId: "test-model",
      doGenerate: {
        content: [{ type: "text", text: "private-output-canary" }],
        warnings: [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 3, text: 3, reasoning: 0 },
        },
      },
    }),
    prompt: "private-input-canary",
  });
  await shutdownOpenTelemetry();
  const spans = batches.join("");
  assert.match(spans, /gen_ai\.operation\.name/);
  assert.match(spans, /test-model/);
  assert.doesNotMatch(spans, /private-(input|output)-canary/);
  assert.equal(agentModelTelemetry(), undefined);
});
