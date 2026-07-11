const ARTIFACT_RUNTIME_MARKER = 'data-chat-artifact-runtime="true"';
const SELF_SCRIPT_SOURCE = "script-src 'self'";
const ECHARTS_RUNTIME_PATH_PREFIX = "/runtime/echarts/";

export function prepareArtifactPreviewHtml(html: string): string {
  if (!html.includes(ARTIFACT_RUNTIME_MARKER)) return html;

  const runtimePath = html.match(
    /<script\b[^>]*\bsrc="(\/runtime\/echarts\/[^"]+)"[^>]*>/i,
  )?.[1];
  if (!runtimePath?.startsWith(ECHARTS_RUNTIME_PATH_PREFIX)) return html;

  const runtimeUrl = new URL(runtimePath, window.location.origin);
  return html.replace(
    SELF_SCRIPT_SOURCE,
    `${SELF_SCRIPT_SOURCE} ${runtimeUrl.href}`,
  );
}
