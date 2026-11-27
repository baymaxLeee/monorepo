import { createAgent, registerTools, type AgentAction } from "@ui-sdk/react/agent";
import { useLayoutEffect, useSyncExternalStore } from "react";

export type AgentUIPermissionMode = "confirm" | "allow" | "read-only";
type PermissionRequest = { action: AgentAction; resolve: (allowed: boolean) => void };
type BridgeState = { mode: AgentUIPermissionMode; request: PermissionRequest | null; shareChanges: boolean };

export function createWorkspaceBridge() {
  let state: BridgeState = { mode: "confirm", request: null, shareChanges: false };
  let active = false;
  type Change = { ref: string; label: string; key: string; value: unknown };
  const changes = new Map<string, Change>();
  const listeners = new Set<() => void>();
  function publish(next: BridgeState) {
    state = next;
    for (const listener of listeners) listener();
  }
  function setMode(mode: AgentUIPermissionMode) {
    state.request?.resolve(false);
    publish({ ...state, mode, request: null });
  }
  function allow(action: AgentAction, { signal }: { signal: AbortSignal }): boolean | Promise<boolean> {
    if (!active || signal.aborted || state.mode === "read-only") return false;
    if (state.mode === "allow" && !action.confirm) return true;
    if (state.request) return false;
    return new Promise<boolean>((resolve) => {
      const finish = (allowed: boolean) => {
        signal.removeEventListener("abort", abort);
        if (state.request?.resolve === finish) publish({ ...state, request: null });
        resolve(allowed);
      };
      const abort = () => finish(false);
      signal.addEventListener("abort", abort, { once: true });
      publish({ ...state, request: { action, resolve: finish } });
    });
  }

  // Construct before children mount so the SDK observes their first render.
  const agent = createAgent({ allow });
  return {
    agent,
    setMode,
    snapshot: () => state,
    setShareChanges(enabled: boolean) {
      changes.clear();
      publish({ ...state, shareChanges: enabled });
    },
    prepareContext() {
      if (!state.shareChanges || !changes.size) return undefined;
      const batch = new Map(changes);
      return {
        text: "工作台字段变化（页面数据）\n" + JSON.stringify([...batch.values()]),
        acknowledge() {
          for (const [key, value] of batch) if (changes.get(key) === value) changes.delete(key);
        },
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount() {
      active = true;
      const unsubscribe = agent.subscribe(({ source, ref, label, component, key, value }) => {
        const id = JSON.stringify([ref, key]);
        if (source === "agent") {
          changes.delete(id);
          return;
        }
        if (state.shareChanges && ["value", "checked", "pressed"].includes(key) && value !== "[redacted]") {
          changes.set(id, { ref, label: label ?? component, key, value });
        }
      });
      const unregister = webMCPAvailable() ? registerTools(agent, { allow: () => active }) : undefined;
      return () => {
        active = false;
        unsubscribe();
        changes.clear();
        unregister?.();
        state.request?.resolve(false);
        publish({ mode: "confirm", request: null, shareChanges: false });
      };
    },
    async execute(toolName: string, input: unknown, { signal }: { signal: AbortSignal }) {
      signal.throwIfAborted();
      if (!active) throw new Error("工作台已经关闭");
      if (toolName === "snapshot") return agent.snapshot();
      if (toolName === "query") {
        const query = (input ?? {}) as Parameters<typeof agent.query>[0];
        if (!query.closed) return agent.query(query);
        // beta.18 can navigate for a closed-panel query but only act() accepts
        // a signal. Bind this read's navigation permissions to its caller.
        const reader = createAgent({
          allow: (action, context) => allow(action, { signal: AbortSignal.any([signal, context.signal]) }),
        });
        const result = await reader.query(query);
        signal.throwIfAborted();
        return result;
      }
      if (toolName === "act") return agent.act(input as Parameters<typeof agent.act>[0], { signal });
      throw new Error(`不支持的页面工具 ${toolName}`);
    },
  };
}
export type WorkspaceBridge = ReturnType<typeof createWorkspaceBridge>;

export function useBridgeState(bridge: WorkspaceBridge) {
  return useSyncExternalStore(bridge.subscribe, bridge.snapshot, bridge.snapshot);
}

export function useWebMCPRegistration(bridge: WorkspaceBridge) {
  useLayoutEffect(() => bridge.mount(), [bridge]);
}

export function webMCPAvailable(): boolean {
  const context = (globalThis.document as (Document & { modelContext?: { registerTool?: unknown } }) | undefined)
    ?.modelContext;
  return typeof context?.registerTool === "function";
}
