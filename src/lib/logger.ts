// ============================================
// Structured JSON logging
// Always includes: timestamp, level, stage, requestId (when available)
// ============================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Stage =
  | "startup"
  | "slack"
  | "rewrite"
  | "retrieve"
  | "rerank"
  | "synthesize"
  | "render"
  | "index"
  | "github"
  // V2 stages
  | "router"
  | "retrieval"
  | "grounding"
  | "llm"
  | "pipeline"
  | "evidence"
  | "attachments"
  | "indexer"
  // V3 stages
  | "guardrails"
  // API stages
  | "api"
  // Dashboard stages
  | "auth"
  | "dashboard"
  | "db";

interface LogContext {
  requestId?: string;
  stage?: Stage;
  threadTs?: string;
  channelId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  stage?: Stage;
  requestId?: string;
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context: LogContext = {}): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  return JSON.stringify(entry);
}

/** Main logger with context support */
export const logger = {
  debug(message: string, context?: LogContext): void {
    if (process.env["NODE_ENV"] !== "production") {
      console.log(formatLog("debug", message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    console.log(formatLog("info", message, context));
  },

  warn(message: string, context?: LogContext): void {
    console.warn(formatLog("warn", message, context));
  },

  error(message: string, context?: LogContext & { error?: unknown }): void {
    const { error, ...rest } = context || {};
    const errorInfo = error instanceof Error
      ? { errorMessage: error.message, errorStack: error.stack }
      : error
        ? { errorMessage: String(error) }
        : {};
    console.error(formatLog("error", message, { ...rest, ...errorInfo }));
  },
};

/** Create a logger bound to a specific request */
export function createRequestLogger(requestId: string, stage?: Stage) {
  return {
    debug(message: string, context?: Omit<LogContext, "requestId">): void {
      logger.debug(message, { ...context, requestId, stage });
    },

    info(message: string, context?: Omit<LogContext, "requestId">): void {
      logger.info(message, { ...context, requestId, stage });
    },

    warn(message: string, context?: Omit<LogContext, "requestId">): void {
      logger.warn(message, { ...context, requestId, stage });
    },

    error(message: string, context?: Omit<LogContext, "requestId"> & { error?: unknown }): void {
      logger.error(message, { ...context, requestId, stage });
    },

    /** Create a child logger for a different stage */
    withStage(newStage: Stage) {
      return createRequestLogger(requestId, newStage);
    },
  };
}

export type RequestLogger = ReturnType<typeof createRequestLogger>;
