export function platformUrl(raw: string, allowHttp = false): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Platform 地址不能包含凭据、查询参数或片段");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (local || allowHttp)))
    throw new Error("远程 Platform 请使用 HTTPS；受控 HTTP 验证需显式传入 --allow-http");
  if (url.pathname !== "/") throw new Error("请填写 Platform 的根地址");
  return url;
}
