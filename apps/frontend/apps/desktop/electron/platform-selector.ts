import { BrowserWindow } from "electron";

export interface PlatformSelection {
  url: string;
  allowHttp: boolean;
}

const selectionOrigin = "https://desktop.invalid";

function page(defaultUrl: string, allowHttp: boolean): string {
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action ${selectionOrigin}">
    <title>连接 Platform</title>
    <style>
      :root { color-scheme: light dark; font: 14px -apple-system, BlinkMacSystemFont, sans-serif; }
      body { margin: 0; background: Canvas; color: CanvasText; }
      main { max-width: 480px; margin: 0 auto; padding: 42px 36px 32px; }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0 0 26px; color: GrayText; line-height: 1.5; }
      label { display: block; margin-bottom: 8px; font-weight: 600; }
      input[type="url"] { box-sizing: border-box; width: 100%; padding: 11px 12px; border: 1px solid GrayText; border-radius: 8px; background: Field; color: FieldText; font: inherit; }
      .option { display: flex; gap: 8px; align-items: flex-start; margin: 16px 0 26px; font-weight: 400; line-height: 1.4; }
      .option input { margin-top: 2px; }
      button { float: right; border: 0; border-radius: 8px; padding: 10px 18px; background: AccentColor; color: AccentColorText; font: inherit; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>连接 Platform</h1>
      <p>填写 Platform 根地址。应用只会向这个 origin 开放登录和本地 Agent 能力。</p>
      <form method="get" action="${selectionOrigin}/connect">
        <label for="url">Platform URL</label>
        <input id="url" name="url" type="url" value="${escapeAttribute(defaultUrl)}" placeholder="https://platform.example.com" required autofocus>
        <label class="option">
          <input name="allow_http" type="checkbox" value="1"${allowHttp ? " checked" : ""}>
          <span>允许远程 HTTP（不安全，登录信息可能被窃取；localhost 不需要勾选）</span>
        </label>
        <button type="submit">连接</button>
      </form>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function selectPlatform(defaultUrl: string, allowHttp = false): Promise<PlatformSelection | null> {
  return new Promise((resolve) => {
    const selector = new BrowserWindow({
      width: 560,
      height: 410,
      minWidth: 560,
      minHeight: 410,
      maxWidth: 560,
      maxHeight: 410,
      resizable: false,
      title: "连接 Platform",
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        navigateOnDragDrop: false,
      },
    });
    let finished = false;
    const finish = (selection: PlatformSelection | null) => {
      if (finished) return;
      finished = true;
      resolve(selection);
      if (!selector.isDestroyed()) selector.close();
    };
    selector.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    selector.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    selector.webContents.on("will-navigate", (event, target) => {
      event.preventDefault();
      const submitted = new URL(target);
      if (submitted.origin !== selectionOrigin || submitted.pathname !== "/connect") return;
      finish({
        url: submitted.searchParams.get("url") ?? "",
        allowHttp: submitted.searchParams.get("allow_http") === "1",
      });
    });
    selector.once("ready-to-show", () => selector.show());
    selector.on("closed", () => finish(null));
    void selector.loadURL(page(defaultUrl, allowHttp)).catch(() => finish(null));
  });
}
