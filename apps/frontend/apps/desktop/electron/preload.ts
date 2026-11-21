import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { DesktopBridge, DesktopEvent } from "../contracts/bridge.generated";

const expected = process.argv.find((value) => value.startsWith("--desktop-origin="))?.slice("--desktop-origin=".length);
declare const location: { origin: string };
if (process.isMainFrame && expected && location.origin === decodeURIComponent(expected)) {
  const call = <T>(method: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke("desktop:invoke", method, payload);
  const bridge: DesktopBridge = {
    version: 8,
    info: () => call("info"),
    bindSession: (accessToken, expiresAt) => call("bindSession", { accessToken, expiresAt }),
    clearSession: () => call("clearSession"),
    refreshSession: () => call("refreshSession"),
    importLocalPlugin: () => call("importLocalPlugin"),
    listLocalPlugins: () => call("listLocalPlugins"),
    listThreads: () => call("list"),
    selectWorkspace: () => call("selectWorkspace"),
    createThread: (workspace, providerId, reasoningEffort, approvalPolicy, permissionProfile, pluginActivations) =>
      call("create", {
        workspace,
        providerId,
        reasoningEffort,
        approvalPolicy,
        permissionProfile,
        pluginActivations,
      }),
    referenceFile: async (id, file) => {
      const path = webUtils.getPathForFile(file);
      if (path) {
        const relativePath = await call<string | null>("workspaceFilePath", { id, path });
        if (relativePath !== null) return relativePath;
      }
      if (file.size > 10 * 1024 * 1024) throw new Error("本地附件不能超过 10 MiB");
      return call<string>("importAttachment", {
        id,
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    },
    getThread: (id) => call("get", id),
    openStream: (id) => call("openStream", id),
    send: (id, parts, messageId) => call("send", { id, parts, messageId }),
    submitRunInput: (id, expectedTurnId, text, messageId, mode) =>
      call("submitRunInput", { id, expectedTurnId, text, messageId, mode }),
    approve: (id, approvalId, approved) => call("approve", { id, approvalId, approved }),
    setExecutionPolicy: (id, approvalPolicy, permissionProfile) =>
      call("setExecutionPolicy", { id, approvalPolicy, permissionProfile }),
    setModelBinding: (id, providerId, reasoningEffort) => call("setModelBinding", { id, providerId, reasoningEffort }),
    stop: (id) => call("stop", id),
    removeThread: (id) => call("remove", id),
    listFiles: (id, path) => call("listFiles", { id, path }),
    readFile: (id, path) => call("readFile", { id, path }),
    writeFile: (id, path, content, expectedHash) => call("writeFile", { id, path, content, expectedHash }),
    subscribe: (listener) => {
      const handler = (_event: unknown, data: DesktopEvent) => listener(data);
      ipcRenderer.on("desktop:event", handler);
      return () => ipcRenderer.removeListener("desktop:event", handler);
    },
  };
  contextBridge.exposeInMainWorld("desktop", Object.freeze(bridge));
}
