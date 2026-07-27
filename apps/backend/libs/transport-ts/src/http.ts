import createClient, { type Client } from "openapi-fetch";

export class TransportError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export interface InternalClientOptions {
  baseUrl: string;
  internalToken: string;
  service: string;
  callerService: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  propagatedHeaders?: () => Record<string, string> | undefined;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  expectBinary?: boolean;
}

export interface BinaryResponse {
  bytes: Uint8Array;
  contentType: string;
}

export type InternalOpenApiClient<Paths extends object> = Client<Paths>;

export function createInternalOpenApiClient<Paths extends object>(
  options: InternalClientOptions,
): InternalOpenApiClient<Paths> {
  const http = new InternalHttpClient(options);
  return createClient<Paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ""),
    headers: {
      "X-Internal-Token": options.internalToken,
      "X-Caller-Service": options.callerService,
    },
    fetch: (request) => http.fetch(request),
  });
}

export class InternalHttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: InternalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetch(request: Request): Promise<Response> {
    const extra = this.options.propagatedHeaders?.();
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (!request.headers.has(key)) {
          request.headers.set(key, value);
        }
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(request, { signal: anySignal([controller.signal, request.signal]) });
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async requestJson<T>(options: RequestOptions): Promise<T> {
    const response = await this.request(options);
    const data = await readJson(response);
    if (!response.ok) {
      throw new TransportError(
        this.options.service,
        response.status,
        `${this.options.service} request failed: ${response.status}`,
        data,
      );
    }
    return data as T;
  }

  async requestBinary(options: RequestOptions): Promise<BinaryResponse> {
    const response = await this.request(options);
    if (!response.ok) {
      throw new TransportError(
        this.options.service,
        response.status,
        `${this.options.service} request failed: ${response.status}`,
        await readJson(response),
      );
    }
    const rawMime = response.headers.get("content-type") ?? "application/octet-stream";
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: rawMime.split(";")[0]?.trim() || "application/octet-stream",
    };
  }

  async requestStream(options: RequestOptions): Promise<Response> {
    const response = await this.request(options, false);
    if (!response.ok) {
      throw new TransportError(
        this.options.service,
        response.status,
        `${this.options.service} request failed: ${response.status}`,
        await readJson(response),
      );
    }
    return response;
  }

  private async request(options: RequestOptions, timeout = true): Promise<Response> {
    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    const url = new URL(`${this.baseUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const extra = this.options.propagatedHeaders?.() ?? {};
    try {
      return await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          "X-Internal-Token": this.options.internalToken,
          "X-Caller-Service": this.options.callerService,
          ...extra,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: anySignal([controller.signal, options.signal]),
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const liveSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (liveSignals.length === 1) {
    return liveSignals[0];
  }

  const controller = new AbortController();
  for (const signal of liveSignals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
