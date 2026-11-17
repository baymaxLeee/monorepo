import { createLogger, type Logger } from "#runtime/foundation";

export const logger: Logger = createLogger({ service: "runtime-worker" });
