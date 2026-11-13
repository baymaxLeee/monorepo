import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isToolUIPart } from "ai";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { z } from "zod";

import type { LocalThread } from "../contracts/bridge.generated";
import { DesktopAuth } from "./auth";
import { RuntimeHost } from "./host-runtime";
import { platformUrl } from "./platform-url";
import { legacySessionDirectories, resolveRuntimeHome, scopedSessionDirectory } from "./runtime-home";

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (argument("user-data")) app.setPath("userData", argument("user-data")!);
const directory = __dirname;
let window: BrowserWindow | null = null,
  runtime: RuntimeHost | null = null,
  quitting = false;
let authReady: Promise<unknown> = Promise.resolve();
let signedIn = false;

async function start() {
  const packaged = await readFile(join(directory, "platform.json"), "utf8")
    .then((text) => JSON.parse(text) as { url: string })
    .catch(() => null);
  const url = platformUrl(
    argument("platform-url") ?? packaged?.url ?? "http://localhost:3000",
    process.argv.includes("--allow-http"),
  );
  const runtimeHome = resolveRuntimeHome();
  if (!app.requestSingleInstanceLock({ origin: url.origin })) {
    app.quit();
    return;
  }
  await app.whenReady();
  runtime = new RuntimeHost(
    directory,
    (path, init) => auth.fetch(path, init),
    (event) => {
      if (window && !window.isDestroyed() && window.webContents.getURL().startsWith(`${url.origin}/`))
        window.webContents.send("desktop:event", event);
    },
  );
  const auth = new DesktopAuth(url.origin, async (scope) => {
    signedIn = false;
    if (scope) {
      await runtime!.call("open", {
        directory: scopedSessionDirectory(runtimeHome, scope),
        legacyDirectories: legacySessionDirectories(app.getPath("appData"), app.getPath("userData"), scope),
        controlDirectories: [runtimeHome, app.getPath("userData")],
        supervisor: join(directory, "supervisor"),
        executable: process.execPath,
        fileWorker: join(directory, "file-worker.cjs"),
      });
      signedIn = true;
    } else await runtime!.call("close");
  });
  const id = z.string().uuid();
  const file = z.strictObject({ id, path: z.string().max(4096) });
  ipcMain.handle("desktop:invoke", async (event, method: unknown, payload: unknown) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== url.origin
    )
      throw new Error("拒绝非 Platform 主页面的本地调用");
    if (method === "info")
      return { platform: process.platform, localAvailable: process.platform === "darwin", origin: url.origin };
    if (method === "bindSession") {
      const p = z
        .strictObject({ accessToken: z.string().min(1).max(16_384), expiresAt: z.iso.datetime({ offset: true }) })
        .parse(payload);
      authReady = auth.bind(p.accessToken, p.expiresAt);
      return authReady;
    }
    if (method === "refreshSession") {
      authReady = auth.refresh();
      return authReady;
    }
    if (method === "clearSession") {
      authReady = auth.clear();
      return authReady;
    }
    await authReady;
    if (!signedIn) throw new Error("请先登录并选择组织工作区");
    if (process.platform !== "darwin") throw new Error("本地模式目前仅支持 macOS");
    const scope = auth.identity();
    const scopedCall = async <T = unknown>(operation: string, input?: unknown): Promise<T> => {
      await authReady;
      if (!signedIn || auth.identity() !== scope) throw new Error("登录身份已改变，请重试");
      const result = await runtime!.call<T>(operation, input);
      if (!signedIn || auth.identity() !== scope) throw new Error("登录身份已改变，请重试");
      return result;
    };
    switch (method) {
      case "list":
        return scopedCall("list");
      case "create": {
        const p = z.strictObject({ agentId: z.string().min(1).max(32).nullable() }).parse(payload);
        const selected = await dialog.showOpenDialog(window, {
          title: "选择 Agent 可以修改的项目目录",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const permission = await dialog.showMessageBox(window, {
          type: "question",
          title: "授权本地工作目录",
          message: "允许 Agent 读取和修改此目录？",
          detail: `${selected.filePaths[0]}\n\n文件和会话保存在本机。用于推理的内容会发送给平台配置的模型；命令默认不能联网。`,
          buttons: ["取消", "允许并创建会话"],
          defaultId: 0,
          cancelId: 0,
        });
        if (permission.response !== 1) return null;
        return scopedCall("create", { workspace: selected.filePaths[0], agentId: p.agentId });
      }
      case "openStream":
      case "get":
      case "stop":
        return scopedCall(method, id.parse(payload));
      case "remove": {
        const threadId = id.parse(payload);
        const confirmed = await dialog.showMessageBox(window, {
          type: "question",
          message: "删除本地会话记录？工作目录中的文件会保留。",
          buttons: ["取消", "删除记录"],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirmed.response === 1) await scopedCall("remove", threadId);
        return null;
      }
      case "send":
        return scopedCall(
          "send",
          z.strictObject({ id, messageId: id, text: z.string().trim().min(1).max(64_000) }).parse(payload),
        );
      case "steer":
        return scopedCall(
          "steer",
          z
            .strictObject({
              id,
              expectedTurnId: id,
              messageId: id,
              text: z.string().trim().min(1).max(64_000),
              delivery: z.enum(["steer", "queue"]),
            })
            .parse(payload),
        );
      case "approve": {
        const p = z.strictObject({ id, approvalId: z.string().max(200), approved: z.boolean() }).parse(payload);
        if (p.approved) {
          const thread = await scopedCall<LocalThread>("get", p.id);
          const part = thread.messages
            .flatMap((message) => message.parts)
            .find(
              (part) => isToolUIPart(part) && part.state === "approval-requested" && part.approval.id === p.approvalId,
            );
          if (!part || !isToolUIPart(part)) throw new Error("审批不存在或已过期");
          const result = await dialog.showMessageBox(window, {
            type: "question",
            title: "允许执行本地命令",
            message: `在 ${thread.workspace} 中执行此命令？`,
            detail: JSON.stringify(part.input, null, 2),
            buttons: ["拒绝", "允许本次执行"],
            defaultId: 0,
            cancelId: 0,
          });
          p.approved = result.response === 1;
        }
        return scopedCall("approve", p);
      }
      case "listFiles":
      case "readFile":
        return scopedCall(method, file.parse(payload));
      case "writeFile":
        return scopedCall(
          method,
          file
            .extend({ content: z.string().max(2 * 1024 * 1024), expectedHash: z.string().max(64).nullable() })
            .parse(payload),
        );
      default:
        throw new Error("未开放的桌面能力");
    }
  });
  const createWindow = () => {
    window = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      title: "Monorepo",
      show: false,
      webPreferences: {
        preload: join(directory, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        navigateOnDragDrop: false,
        additionalArguments: [`--desktop-origin=${encodeURIComponent(url.origin)}`],
      },
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, target) => {
      const parsed = new URL(target);
      if (parsed.origin !== url.origin) {
        event.preventDefault();
        if (["https:", "http:"].includes(parsed.protocol)) void shell.openExternal(target);
      }
    });
    window.webContents.on("will-redirect", (event, target) => {
      if (new URL(target).origin !== url.origin) event.preventDefault();
    });
    window.webContents.on("will-prevent-unload", (event) => {
      if (
        window &&
        dialog.showMessageBoxSync(window, {
          type: "question",
          message: "放弃未保存的本地文件草稿？",
          buttons: ["继续编辑", "放弃并离开"],
          defaultId: 0,
          cancelId: 0,
        }) === 1
      )
        event.preventDefault();
    });
    window.once("ready-to-show", () => window?.show());
    window.on("closed", () => {
      window = null;
    });
    void window.loadURL(url.href).catch(async () => {
      await dialog.showMessageBox({
        type: "error",
        message: "无法打开 Platform",
        detail: `请确认 ${url.origin} 已启动，然后通过菜单重新加载。`,
      });
      window?.show();
    });
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      {
        label: "视图",
        submenu: [
          {
            label: "重新加载 Platform",
            accelerator: "CmdOrCtrl+R",
            click: () => {
              if (window) void window.loadURL(url.href);
            },
          },
          { role: "toggleDevTools" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
  app.on("second-instance", () => {
    if (!window) createWindow();
    window?.show();
    window?.focus();
  });
  app.on("activate", () => {
    if (!window) createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  createWindow();
}
app.on("will-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void runtime
    ?.close()
    .catch(() => undefined)
    .finally(() => app.quit());
  if (!runtime) app.quit();
});
void start().catch(async (error: unknown) => {
  await app.whenReady();
  await dialog.showMessageBox({
    type: "error",
    message: "桌面应用启动失败",
    detail: error instanceof Error ? error.message : "未知错误",
  });
  app.quit();
});
