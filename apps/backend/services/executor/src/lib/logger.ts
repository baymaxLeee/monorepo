import { createLogger, type Logger } from "@backend/kernel-ts";

export const logger: Logger = createLogger({ service: "executor" });
