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
    readonly defaultTimeoutMs = 10_000,
  ) {
    if (!service) throw new Error("inner API caller service is required");
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
    const metadata = new Metadata();
    metadata.set("x-caller-service", this.service);
    for (const [key, value] of Object.entries(options.headers ?? {})) metadata.set(key.toLowerCase(), value);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
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
    const metadata = new Metadata();
    metadata.set("x-caller-service", this.service);
    for (const [key, value] of Object.entries(headers)) metadata.set(key.toLowerCase(), value);
    return metadata;
  }

  deadline(timeoutMs = this.defaultTimeoutMs): { deadline: Date } {
    return { deadline: new Date(Date.now() + timeoutMs) };
  }

  error(error: ServiceError): InnerApiError {
    return new InnerApiError(error.code, error.details || error.message, error);
  }
}

export const insecureChannelCredentials = credentials.createInsecure();
