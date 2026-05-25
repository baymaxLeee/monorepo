const SENSITIVE_KEY = /(password|token|authorization|cookie|secret)/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(redact);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.slice(0, 8000);
  }
  return value;
}
