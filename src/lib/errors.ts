// ============================================
// Standard error types for consistent handling
// ============================================

export type ErrorCode =
  | "RETRIEVAL_FAILED"
  | "SYNTHESIS_FAILED"
  | "SLACK_API_ERROR"
  | "GITHUB_WEBHOOK_ERROR"
  | "INDEXING_FAILED"
  | "CONFIG_ERROR"
  | "VALIDATION_ERROR"
  | "UNKNOWN_ERROR";

export interface AppError {
  code: ErrorCode;
  message: string;
  requestId?: string;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class LightopediaError extends Error implements AppError {
  code: ErrorCode;
  requestId?: string;
  override cause?: unknown;
  context?: Record<string, unknown>;

  constructor(options: AppError) {
    super(options.message);
    this.name = "LightopediaError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.cause = options.cause;
    this.context = options.context;
  }

  toJSON(): AppError {
    return {
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      context: this.context,
    };
  }
}

/** Create a retrieval error */
export function retrievalError(message: string, requestId?: string, cause?: unknown): LightopediaError {
  return new LightopediaError({
    code: "RETRIEVAL_FAILED",
    message,
    requestId,
    cause,
  });
}

/** Create a synthesis error */
export function synthesisError(message: string, requestId?: string, cause?: unknown): LightopediaError {
  return new LightopediaError({
    code: "SYNTHESIS_FAILED",
    message,
    requestId,
    cause,
  });
}

/** Create a Slack API error */
export function slackError(message: string, cause?: unknown): LightopediaError {
  return new LightopediaError({
    code: "SLACK_API_ERROR",
    message,
    cause,
  });
}

/** Wrap unknown errors */
export function wrapError(err: unknown, requestId?: string): LightopediaError {
  if (err instanceof LightopediaError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  return new LightopediaError({
    code: "UNKNOWN_ERROR",
    message,
    requestId,
    cause: err,
  });
}

/** User-friendly error messages */
export function getUserMessage(error: AppError): string {
  switch (error.code) {
    case "RETRIEVAL_FAILED":
      return "I couldn't search the knowledge base. Please try again.";
    case "SYNTHESIS_FAILED":
      return "I found some information but couldn't generate an answer. Please try again.";
    case "SLACK_API_ERROR":
      return "There was an issue with Slack. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
