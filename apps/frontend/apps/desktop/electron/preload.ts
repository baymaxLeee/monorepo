import { contextBridge, ipcRenderer } from "electron";

import type { DesktopBridge, DesktopEvent } from "../contracts/bridge.generated";

const expected = process.argv.find((value) => value.startsWith("--desktop-origin="))?.slice("--desktop-origin=".length);
declare const location: { origin: string };
if (process.isMainFrame && expected && location.origin === decodeURIComponent(expected)) {
  const call = <T>(method: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke("desktop:invoke", method, payload);
  const bridge: DesktopBridge = {
    version: 1,
    info: () => call("info"),
    bindSession: (accessToken, expiresAt) => call("bindSession", { accessToken, expiresAt }),
    clearSession: () => call("clearSession"),
    refreshSession: () => call("refreshSession"),
    listThreads: () => call("list"),
    createThread: (agentId) => call("create", { agentId }),
    getThread: (id) => call("get", id),
    openStream: (id) => call("openStream", id),
    send: (id, text, messageId) => call("send", { id, text, messageId }),
    steer: (id, expectedTurnId, text, messageId, delivery) =>
      call("steer", { id, expectedTurnId, text, messageId, delivery }),
    approve: (id, approvalId, approved) => call("approve", { id, approvalId, approved }),
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
