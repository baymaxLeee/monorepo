export function formatTraceTime(value: string) {
  if (!value) return "-";
  const normalized = value.includes(" ")
    ? `${value.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1")}Z`
    : value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(normalized));
}

export function shortTraceId(value: string) {
  return value ? value.slice(0, 12) : "-";
}

export function formatTraceDuration(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}
