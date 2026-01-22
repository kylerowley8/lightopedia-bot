// ============================================
// Dashboard Routes — Key CRUD endpoints
// ============================================

import type { Request, Response } from "express";
import { z } from "zod";
import { createApiKey, listUserApiKeys, revokeApiKey } from "../db/apiKeys.js";
import type { AuthenticatedDashboardRequest } from "../auth/middleware.js";
import { logger } from "../lib/logger.js";

const createKeySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(50, "Name cannot exceed 50 characters")
    .regex(/^[a-zA-Z0-9\s\-_]+$/, "Name can only contain letters, numbers, spaces, hyphens, and underscores"),
});

/**
 * GET /dashboard/api/keys — List user's API keys.
 */
export async function handleListKeys(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedDashboardRequest;
  const userId = authReq.session.userId;

  try {
    const keys = await listUserApiKeys(userId);
    res.json({ keys });
  } catch (err) {
    logger.error("Failed to list API keys", {
      stage: "dashboard",
      userId,
      error: err,
    });
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to list API keys",
    });
  }
}

/**
 * POST /dashboard/api/keys — Create a new API key.
 */
export async function handleCreateKey(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedDashboardRequest;
  const userId = authReq.session.userId;

  // Validate input
  const result = createKeySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "Invalid input",
    });
    return;
  }

  const { name } = result.data;

  try {
    const keyResult = await createApiKey(userId, name);

    if (!keyResult) {
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Failed to create API key",
      });
      return;
    }

    logger.info("API key created via dashboard", {
      stage: "dashboard",
      userId,
      keyId: keyResult.key.id,
    });

    res.status(201).json({
      key: keyResult.key,
      rawKey: keyResult.rawKey, // Only returned once!
    });
  } catch (err) {
    logger.error("Failed to create API key", {
      stage: "dashboard",
      userId,
      error: err,
    });
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to create API key",
    });
  }
}

/**
 * DELETE /dashboard/api/keys/:id — Revoke an API key.
 */
export async function handleRevokeKey(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedDashboardRequest;
  const userId = authReq.session.userId;
  const keyIdParam = req.params["id"];
  const keyId = Array.isArray(keyIdParam) ? keyIdParam[0] : keyIdParam;

  if (!keyId) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Key ID is required",
    });
    return;
  }

  try {
    const success = await revokeApiKey(keyId, userId);

    if (!success) {
      res.status(404).json({
        error: "NOT_FOUND",
        message: "API key not found or already revoked",
      });
      return;
    }

    logger.info("API key revoked via dashboard", {
      stage: "dashboard",
      userId,
      keyId,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error("Failed to revoke API key", {
      stage: "dashboard",
      userId,
      keyId,
      error: err,
    });
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to revoke API key",
    });
  }
}

/**
 * GET /dashboard/api/me — Get current user info.
 */
export function handleGetMe(req: Request, res: Response): void {
  const authReq = req as AuthenticatedDashboardRequest;

  res.json({
    userId: authReq.session.userId,
    email: authReq.session.email,
    name: authReq.session.name,
    pictureUrl: authReq.session.pictureUrl,
  });
}
