// ============================================
// API Middleware — Auth, Rate Limiting, Validation
// ============================================

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { config } from "../config/env.js";
import { validateDbApiKey } from "../db/apiKeys.js";

// ============================================
// Types
// ============================================

export interface AuthenticatedRequest extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
  apiKeyUserId?: string; // User ID if key is from DB
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ============================================
// API Key Authentication
// ============================================

/**
 * Validate API key using timing-safe comparison.
 * Supports multiple API keys for different clients.
 * Checks database first, then falls back to env var keys.
 */
export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Missing Authorization header",
    });
    return;
  }

  // Expect "Bearer <api-key>" format
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Invalid Authorization header format. Use: Bearer <api-key>",
    });
    return;
  }

  const providedKey = parts[1] ?? "";

  // First, check database for self-service keys (keys starting with "lp_")
  if (providedKey.startsWith("lp_")) {
    try {
      const dbKey = await validateDbApiKey(providedKey);
      if (dbKey) {
        req.apiKeyId = dbKey.keyId;
        req.apiKeyName = dbKey.keyName;
        req.apiKeyUserId = dbKey.userId;
        next();
        return;
      }
    } catch (err) {
      logger.error("Database key validation error", {
        stage: "api",
        error: err,
      });
      // Fall through to env var check
    }
  }

  // Fall back to env var keys (for backward compatibility)
  const validKey = validateEnvApiKey(providedKey);

  if (!validKey) {
    const userAgent = req.headers["user-agent"];
    logger.warn("Invalid API key attempt", {
      stage: "api",
      ip: req.ip ?? "unknown",
      userAgent: userAgent ? userAgent.slice(0, 100) : "unknown",
    });

    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Invalid API key",
    });
    return;
  }

  // Attach key info to request for logging/auditing
  req.apiKeyId = validKey.id;
  req.apiKeyName = validKey.name;

  next();
}

/**
 * Validate API key from env vars with timing-safe comparison.
 * Returns key metadata if valid, null otherwise.
 */
function validateEnvApiKey(
  providedKey: string
): { id: string; name: string } | null {
  const apiKeys = config.api.keys;

  for (const key of apiKeys) {
    // Use timing-safe comparison to prevent timing attacks
    const providedBuffer = Buffer.from(providedKey);
    const storedBuffer = Buffer.from(key.secret);

    // Only compare if lengths match (timing-safe comparison requires equal lengths)
    if (
      providedBuffer.length === storedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, storedBuffer)
    ) {
      return { id: key.id, name: key.name };
    }
  }

  return null;
}

// ============================================
// Rate Limiting
// ============================================

// In-memory rate limit store (use Redis for production with multiple instances)
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Rate limiting middleware.
 * Limits requests per API key or IP address.
 */
export function rateLimit(options: {
  windowMs: number;
  maxRequests: number;
}): (req: AuthenticatedRequest, res: Response, next: NextFunction) => void {
  const { windowMs, maxRequests } = options;

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  }, windowMs);

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Use API key ID if authenticated, otherwise fall back to IP
    const identifier = req.apiKeyId ?? req.ip ?? "unknown";
    const now = Date.now();

    let entry = rateLimitStore.get(identifier);

    if (!entry || entry.resetAt < now) {
      // Create new window
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(identifier, entry);
    } else {
      entry.count++;
    }

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - entry.count);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      logger.warn("Rate limit exceeded", {
        stage: "api",
        identifier,
        count: entry.count,
        limit: maxRequests,
      });

      res.status(429).json({
        error: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}

// ============================================
// Input Validation
// ============================================

/**
 * Request body schema for /api/v1/ask endpoint.
 */
export const askRequestSchema = z.object({
  question: z
    .string()
    .min(1, "Question cannot be empty")
    .max(2000, "Question cannot exceed 2000 characters")
    .refine(
      (q) => !containsSuspiciousPatterns(q),
      "Question contains invalid content"
    ),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      })
    )
    .max(10, "Conversation history cannot exceed 10 messages")
    .optional(),
  options: z
    .object({
      includeEvidence: z.boolean().optional(),
      includeTechnicalDetails: z.boolean().optional(),
    })
    .optional(),
});

export type AskRequest = z.infer<typeof askRequestSchema>;

/**
 * Validation middleware factory.
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>
): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: errors,
      });
      return;
    }

    // Replace body with validated/transformed data
    req.body = result.data;
    next();
  };
}

// ============================================
// Security Helpers
// ============================================

/**
 * Check for suspicious patterns that might indicate prompt injection.
 * This is a basic check - not a complete solution.
 */
function containsSuspiciousPatterns(input: string): boolean {
  const suspiciousPatterns = [
    // Obvious prompt injection attempts
    /ignore\s+(all\s+)?(previous|above|prior)\s+instructions/i,
    /disregard\s+(all\s+)?(previous|above|prior)/i,
    /forget\s+(everything|all|your)\s+(you|instructions)/i,
    /you\s+are\s+now\s+(a|an)\s+/i,
    /new\s+instructions?:/i,
    /system\s*prompt:/i,
    // Attempts to extract system prompts
    /what\s+(are|is)\s+your\s+(system\s+)?prompt/i,
    /repeat\s+your\s+(system\s+)?instructions/i,
    /show\s+me\s+your\s+(system\s+)?prompt/i,
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(input));
}

// ============================================
// Request ID Middleware
// ============================================

/**
 * Add request ID to all requests for tracing.
 */
export function addRequestId(
  req: Request & { requestId?: string },
  res: Response,
  next: NextFunction
): void {
  const requestId =
    (req.headers["x-request-id"] as string) ?? crypto.randomUUID().slice(0, 8);
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

// ============================================
// CORS Configuration
// ============================================

/**
 * CORS middleware with configurable origins.
 */
export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const allowedOrigins = config.api.allowedOrigins;
  const origin = req.headers.origin;

  // Check if origin is allowed
  if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
