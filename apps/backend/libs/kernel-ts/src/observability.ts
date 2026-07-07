import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let shutdownTracerProvider: (() => Promise<void>) | null = null;

export function configureOpenTelemetry(serviceName: string): void {
  if (shutdownTracerProvider) return;

  const tracesEndpoint = tracesEndpointFromEnv();
  if (!tracesEndpoint) return;

  const exporter = new OTLPTraceExporter({ url: tracesEndpoint });
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME ?? serviceName,
      "deployment.environment.name": process.env.ENVIRONMENT ?? "development",
    }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 512,
        maxExportBatchSize: 128,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 5000,
      }),
    ],
  });

  provider.register();
  shutdownTracerProvider = () => provider.shutdown();
}

export async function shutdownOpenTelemetry(): Promise<void> {
  const shutdown = shutdownTracerProvider;
  shutdownTracerProvider = null;
  if (shutdown) await shutdown();
}

export function getTracer(serviceName: string) {
  return trace.getTracer(serviceName);
}

export function startSpan(name: string, attributes?: Record<string, unknown>): Span {
  return trace.getTracer("backend").startSpan(name, {
    attributes: attributes ? spanAttributes(attributes) : undefined,
  });
}

export function runWithActiveSpan<T>(span: Span, fn: () => T): T {
  const spanContext = trace.setSpan(context.active(), span);
  return context.with(spanContext, () => bindResultToContext(fn(), spanContext));
}

export function finishSpan(
  span: Span,
  attributes?: Record<string, unknown>,
  error?: unknown,
): void {
  if (attributes) {
    span.setAttributes(spanAttributes(attributes));
  }
  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (error instanceof Error) {
      span.recordException(error);
    } else {
      span.recordException({ message: String(error) });
    }
  }
  span.end();
}

export function spanAttributes(input: Record<string, unknown>): Attributes {
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      Array.isArray(value)
    ) {
      attributes[key] = value;
    }
  }
  return attributes;
}

export function markSpanError(error: unknown): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setStatus({ code: SpanStatusCode.ERROR });
  if (error instanceof Error) {
    span.recordException(error);
  } else {
    span.recordException({ message: String(error) });
  }
}

function bindResultToContext<T>(result: T, spanContext: Context): T {
  if (!isAsyncIterable(result)) return result;
  return (async function* () {
    const iterator = result[Symbol.asyncIterator]();
    while (true) {
      const next = await context.with(spanContext, () => iterator.next());
      if (next.done) return next.value;
      yield next.value;
    }
  })() as T;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in value &&
      typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function",
  );
}

function tracesEndpointFromEnv(): string {
  if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  }
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/v1/traces`;
}
