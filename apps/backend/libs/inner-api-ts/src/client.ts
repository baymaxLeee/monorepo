import { credentials, type ClientUnaryCall, type ServiceError, Metadata, type status } from "@grpc/grpc-js";

export class InnerApiError extends Error {
  constructor(
    readonly code: status,
    message: string,
    readonly cause?: ServiceError,
  ) {
    super(message);
    this.name = "InnerApiError";
  }
}

export interface InnerApiCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Readonly<Record<string, string>>;
}

export class InnerApiCaller {
  constructor(
    readonly service: string,
    private readonly token: string,
    readonly defaultTimeoutMs = 10_000,
  ) {
    if (!service) throw new Error("inner API caller service is required");
    if (!token) throw new Error("inner API caller credential is required");
    if (defaultTimeoutMs <= 0) throw new Error("inner API deadline must be positive");
  }

  private metadataWith(headers: Readonly<Record<string, string>>): Metadata {
    const metadata = new Metadata();
    for (const [key, value] of Object.entries(headers)) {
      const normalized = key.toLowerCase();
      if (normalized === "x-caller-service" || normalized === "x-internal-token" || normalized.startsWith("grpc-"))
        throw new Error(`inner API metadata ${key} is transport-owned`);
      metadata.set(normalized, value);
    }
    metadata.set("x-caller-service", this.service);
    metadata.set("x-internal-token", this.token);
    return metadata;
  }

  unary<T>(
    start: (
      metadata: Metadata,
      options: { deadline: Date },
      callback: (error: ServiceError | null, response: T) => void,
    ) => ClientUnaryCall,
    options: InnerApiCallOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const metadata = this.metadataWith(options.headers ?? {});
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (timeoutMs <= 0) return Promise.reject(new Error("inner API deadline must be positive"));
    return new Promise<T>((resolve, reject) => {
      const call = start(metadata, { deadline: new Date(Date.now() + timeoutMs) }, (error, response) => {
        options.signal?.removeEventListener("abort", cancel);
        if (error) reject(new InnerApiError(error.code, error.details || error.message, error));
        else resolve(response);
      });
      const cancel = () => call.cancel();
      options.signal?.addEventListener("abort", cancel, { once: true });
    });
  }

  metadata(headers: Readonly<Record<string, string>> = {}): Metadata {
    return this.metadataWith(headers);
  }

  deadline(timeoutMs = this.defaultTimeoutMs): { deadline: Date } {
    if (timeoutMs <= 0) throw new Error("inner API deadline must be positive");
    return { deadline: new Date(Date.now() + timeoutMs) };
  }

  error(error: ServiceError): InnerApiError {
    return new InnerApiError(error.code, error.details || error.message, error);
  }
}

export const insecureChannelCredentials = credentials.createInsecure();
