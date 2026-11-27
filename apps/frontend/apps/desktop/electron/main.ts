import "./process-output";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import { z } from "zod";

import { DesktopAuth } from "./auth";
import { APP_ORIGIN, APP_SCHEME, APP_URL, registerEmbeddedPlatform } from "./embedded-platform";
import { RuntimeHost } from "./host-runtime";
import { parseLocalUserMessageParts } from "./local-user-message";
import { selectPlatform } from "./platform-selector";
import { type PackagedPlatform, platformLaunch, platformUrl } from "./platform-url";
import { resolveRuntimeHome, scopedSessionDirectory } from "./runtime-home";
import {appToolCall, cancelAppCall} from "./local-app-call";
import { importAttachmentRequest, workspaceFileRequest } from "./runtime/attachments";
import { listLocalPlugins, importLocalPlugin } from "./runtime/local-plugins";
import { WorkspaceGrants } from "./workspace-grants";

if (!app.isReady())
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (argument("user-data")) app.setPath("userData", argument("user-data")!);
const directory = __dirname;
const unpackedDirectory = directory.replace(/([/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2");
let window: BrowserWindow | null = null,
  runtime: RuntimeHost | null = null,
  quitting = false;
let authReady: Promise<unknown> = Promise.resolve();
let signedIn = false;

async function start() {
  const packaged = await readFile(join(directory, "platform.json"), "utf8")
    .then((text) => JSON.parse(text) as PackagedPlatform)
    .catch(() => null);
  const launch = platformLaunch(argument("platform-url"), packaged, process.argv.includes("--allow-http"));
  let url = platformUrl(launch.url, launch.allowHttp);
  await app.whenReady();
  if (launch.prompt) {
    let selected = await selectPlatform(url.href, launch.allowHttp);
    while (selected) {
      try {
        url = platformUrl(selected.url, selected.allowHttp);
        break;
      } catch (error) {
        await dialog.showMessageBox({
          type: "error",
          message: "Platform 地址无效",
          detail: error instanceof Error ? error.message : "请填写 Platform 根地址",
        });
        selected = await selectPlatform(selected.url, selected.allowHttp);
      }
    }
    if (!selected) {
      app.quit();
      return;
    }
  }
  const rendererOrigin = launch.embedded ? APP_ORIGIN : url.origin;
  const rendererUrl = launch.embedded ? APP_URL : url.href;
  const isRendererUrl = (value: string) =>
    launch.embedded ? value === APP_ORIGIN || value.startsWith(`${APP_ORIGIN}/`) : new URL(value).origin === url.origin;
  if (launch.embedded) registerEmbeddedPlatform(protocol, net.fetch.bind(net), join(directory, "renderer"), url.origin);
  const runtimeHome = resolveRuntimeHome();
  if (!app.requestSingleInstanceLock({ origin: url.origin })) {
    app.quit();
    return;
  }
  runtime = new RuntimeHost(
    directory,
    (path, init) => auth.fetch(path, init),
    (event) => {
      if (window && !window.isDestroyed() && isRendererUrl(window.webContents.getURL()))
        window.webContents.send("desktop:event", event);
    },
  );
  const workspaceGrants = new WorkspaceGrants();
  const auth = new DesktopAuth(url.origin, async (scope) => {
    signedIn = false;
    workspaceGrants.clear();
    if (scope) {
      await runtime!.call("open", {
        directory: scopedSessionDirectory(runtimeHome, scope),
        controlDirectories: [runtimeHome, app.getPath("userData")],
        supervisor: join(unpackedDirectory, "supervisor"),
        executable: join(unpackedDirectory, "node"),
        fileWorker: join(unpackedDirectory, "file-worker.cjs"),
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
      !isRendererUrl(event.senderFrame.url)
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
    const assertScope = async () => {
      await authReady;
      if (!signedIn || auth.identity() !== scope) throw new Error("登录身份已改变，请重试");
    };
    const scopedCall = async <T = unknown>(operation: string, input?: unknown): Promise<T> => {
      await assertScope();
      const result = await runtime!.call<T>(operation, input);
      await assertScope();
      return result;
    };
    switch (method) {
      case "list":
        return scopedCall("list");
      case "listLocalPlugins": {
        if (!scope) throw new Error("请先登录");
        const plugins = await listLocalPlugins(scopedSessionDirectory(runtimeHome, scope));
        await assertScope();
        return plugins;
      }
      case "importLocalPlugin": {
        if (!scope) throw new Error("请先登录");
        const selected = await dialog.showOpenDialog(window, {
          title: "导入本地插件",
          properties: ["openDirectory"],
        });
        if (selected.canceled || !selected.filePaths[0]) return null;
        await assertScope();
        const plugin = await importLocalPlugin(scopedSessionDirectory(runtimeHome, scope), selected.filePaths[0]);
        await assertScope();
        return plugin;
      }
      case "selectWorkspace": {
        const selected = await dialog.showOpenDialog(window, {
          title: "选择 Agent 可以修改的项目目录",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const permission = await dialog.showMessageBox(window, {
          type: "question",
          title: "授权本地工作目录",
          message: "允许本地助手读取和修改此目录？",
          detail: `${selected.filePaths[0]}\n\n文件和会话保存在本机。用于推理的内容会发送给平台配置的模型；命令可以联网，但始终只能访问此授权目录。`,
          buttons: ["取消", "允许使用此项目"],
          defaultId: 0,
          cancelId: 0,
        });
        if (permission.response !== 1) return null;
        await authReady;
        if (!signedIn || auth.identity() !== scope) throw new Error("登录身份已改变，请重试");
        workspaceGrants.grant(selected.filePaths[0]);
        return selected.filePaths[0];
      }
      case "create": {
        const p = z
          .strictObject({
            workspace: z.string().min(1).max(4096),
            providerId: z.string().min(1).max(32),
            reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
            approvalPolicy: z.enum(["never", "on-request", "unless-trusted", "granular"]),
            permissionProfile: z.enum([":read-only", ":workspace", ":danger-full-access"]),
            pluginActivations: z
              .array(
                z.strictObject({
                  origin: z.literal("local").optional(),
                  pluginId: z
                    .string()
                    .min(3)
                    .max(129)
                    .regex(/^[a-z0-9._-]+@[a-z0-9._-]+$/),
                  bindings: z
                    .record(
                      z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
                      z
                        .string()
                        .min(1)
                        .max(256)
                        .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
                    )
                    .optional(),
                }),
              )
              .max(16),
          })
          .parse(payload);
        const threads = await scopedCall<{ workspace: string }[]>("list");
        if (
          !workspaceGrants.authorize(
            p.workspace,
            threads.map((thread) => thread.workspace),
          )
        ) {
          throw new Error("项目未获得授权，请重新选择");
        }
        return scopedCall("create", p);
      }
      case "callAppTool": return scopedCall(method,appToolCall.parse(payload));
      case "cancelAppCall": return scopedCall(method,cancelAppCall.parse(payload));
      case "workspaceFilePath":
        return scopedCall(method, workspaceFileRequest.parse(payload));
      case "importAttachment":
        return scopedCall(method, importAttachmentRequest.parse(payload));
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
        return scopedCall("send", {
          ...z
            .strictObject({
              id,
              messageId: id,
              parts: z.unknown(),
              clientCapabilities: z.strictObject({ uiAgent: z.literal("ui-sdk").optional() }).optional(),
            })
            .parse(payload),
          parts: parseLocalUserMessageParts((payload as { parts?: unknown }).parts),
        });
      case "continueClientTool":
        return scopedCall(
          "continueClientTool",
          z.strictObject({ id, expectedTurnId: id, message: z.unknown() }).parse(payload),
        );
      case "submitRunInput":
        return scopedCall(
          "submitRunInput",
          z
            .strictObject({
              id,
              expectedTurnId: id,
              messageId: id,
              text: z.string().trim().min(1).max(64_000),
              mode: z.enum(["follow-up", "next-turn"]),
            })
            .parse(payload),
        );
      case "approve": {
        const p = z.strictObject({ id, approvalId: z.string().max(200), approved: z.boolean() }).parse(payload);
        return scopedCall("approve", p);
      }
      case "setExecutionPolicy":
        return scopedCall(
          "setExecutionPolicy",
          z
            .strictObject({
              id,
              approvalPolicy: z.enum(["never", "on-request", "unless-trusted", "granular"]),
              permissionProfile: z.enum([":read-only", ":workspace", ":danger-full-access"]),
            })
            .parse(payload),
        );
      case "setModelBinding":
        return scopedCall(
          "setModelBinding",
          z
            .strictObject({
              id,
              providerId: z.string().min(1).max(32),
              reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
            })
            .parse(payload),
        );
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
        additionalArguments: [`--desktop-origin=${encodeURIComponent(rendererOrigin)}`],
      },
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, target) => {
      const parsed = new URL(target);
      if (!isRendererUrl(target)) {
        event.preventDefault();
        if (["https:", "http:"].includes(parsed.protocol)) void shell.openExternal(target);
      }
    });
    window.webContents.on("will-redirect", (event, target) => {
      if (!isRendererUrl(target)) event.preventDefault();
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
    void window.loadURL(rendererUrl).catch(async () => {
      await dialog.showMessageBox({
        type: "error",
        message: "无法打开 Platform",
        detail: launch.embedded
          ? `无法读取安装包内前端资源；API 后端为 ${url.origin}。`
          : `请确认 ${url.origin} 已启动，然后通过菜单重新加载。`,
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
              if (window) void window.loadURL(rendererUrl);
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
