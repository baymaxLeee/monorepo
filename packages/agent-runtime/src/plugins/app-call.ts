import { z } from "zod";

import { loadMcpServer, mcpAppCallbackSchema } from "./mcp.js";
import type { ResolvedTurnPluginSnapshot } from "./types.js";
import { validateResolvedSnapshot } from "./validation.js";

const storedCard = z.object({
  type: z.string(),
  toolName: z.string().optional(),
  toolCallId: z.string(),
  state: z.literal("output-available"),
  preliminary: z.literal(false).optional(),
  toolMetadata: z.object({ agent: z.object({ source: z.literal("mcp"), pluginId: z.string() }) }),
  output: z.object({
    ok: z.literal(true),
    status: z.literal("completed"),
    data: z.object({
      _meta: z.object({ mcpAppResource: z.object({ uri: z.string(), callback: mcpAppCallbackSchema }) }),
    }),
  }),
});

export function findAppCallback(parts: unknown[], callId: string, name: string) {
  const matches = parts
    .map((part) => storedCard.safeParse(part))
    .flatMap((result) => (result.success && result.data.toolCallId === callId ? [result.data] : []));
  const card = matches[0];
  const resource = card?.output.data._meta.mcpAppResource;
  const receipt = resource?.callback;
  const expected = receipt && `mcp__${receipt.server}__${receipt.tool.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
  if (
    (card?.type === "dynamic-tool" ? card.toolName : card?.type.slice(5)) !== expected ||
    !(card?.type === "dynamic-tool" || card?.type.startsWith("tool-")) ||
    matches.length !== 1 ||
    !receipt ||
    resource?.uri !== receipt.uri ||
    card?.toolMetadata.agent.pluginId !== receipt.pluginId ||
    receipt.tool !== name
  ) {
    throw new Error("此卡片没有该工具的调用权限");
  }
  return receipt;
}

export async function callMcpAppTool(
  snapshot: ResolvedTurnPluginSnapshot,
  receipt: z.infer<typeof mcpAppCallbackSchema>,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  validateResolvedSnapshot(snapshot);
  const current = snapshot.plugins.find(({ manifest }) => manifest.id === receipt.pluginId);
  const server = current?.manifest.mcpServers.find((item) => item.name === receipt.server);
  const grant = snapshot.connectionGrants.find(
    (item) => item.pluginId === receipt.pluginId && item.serverName === receipt.server,
  );
  if (!current || !server || !grant) throw new Error("此会话中的插件已不可用");
  const loaded = loadMcpServer({ plugin: current.manifest, activation: current.activation, server, grant }, { signal });
  try {
    return await loaded.callAppTool(receipt, args);
  } finally {
    await loaded.dispose?.();
  }
}
