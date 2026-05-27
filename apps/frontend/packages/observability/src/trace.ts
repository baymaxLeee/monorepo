export function createTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function traceHeaders(
  traceId = createTraceId(),
): Record<string, string> {
  return {
    "X-Trace-Id": traceId,
    traceparent: `00-${traceId}-${createSpanId()}-01`,
  };
}
