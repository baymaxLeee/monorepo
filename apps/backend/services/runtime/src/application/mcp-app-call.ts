import { randomUUID } from "node:crypto";

import { findAppCallback, callMcpAppTool, type ResolvedTurnPluginSnapshot } from "@repo/agent-runtime";

import { getServerSettings } from "../config/server.js";
import { attachPlatformMcpCredential, bindAppReadGrants } from "../infrastructure/clients/plugin-capabilities.js";
import { logger } from "../infrastructure/observability/logger.js";
import { ConflictError, ForbiddenError } from "./errors.js";
import { getSession } from "./sessions.js";

export async function callSessionAppTool(sessionId: string, callId: string, name: string, args: Record<string, unknown>, snapshot: ResolvedTurnPluginSnapshot, signal: AbortSignal) {
  const session = await getSession(sessionId);
  const parts = session.messages.filter(message => message.role === "assistant" && message.status === "ok").flatMap(message => message.content.parts);
  let receipt;
  try { receipt = findAppCallback(parts,callId,name); }
  catch { throw new ForbiddenError("此卡片没有该工具的调用权限"); }
  const requestId = randomUUID();
  const grants = bindAppReadGrants(attachPlatformMcpCredential(snapshot, getServerSettings()), requestId);
  const audit = {requestId,sessionId,toolCallId:callId,pluginId:receipt.pluginId,tool:name};
  try {
    const result = await callMcpAppTool(grants,receipt,args,signal);
    logger.info({...audit, outcome:result.isError ? "tool-error":"completed"}, "MCP App tool call");
    return result;
  } catch {
    logger.warn({...audit, outcome:"failed"}, "MCP App tool call");
    throw new ConflictError("工具权限、界面或参数已变化，或服务暂时不可用，请重新执行原工具");
  }
}
