import pino, { type Logger, type LoggerOptions } from "pino";

import { getRequestContext, PROPAGATED_FIELDS } from "./trace.js";

export interface CreateLoggerOptions {
  service: string;
  level?: string;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    // Replaces pino's default { pid, hostname } base so only the contract
    // fields ship; service is stamped on every line.
    base: { service: options.service },
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    messageKey: "msg",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    mixin() {
      const context = getRequestContext();
      if (!context) return {};
      const fields: Record<string, string> = {};
      for (const field of PROPAGATED_FIELDS) {
        const value = context[field.ctxKey];
        if (value) fields[field.logKey] = value;
      }
      return fields;
    },
  };
  return pino(config);
}

export type { Logger };
