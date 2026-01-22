// ============================================
// Dashboard Module Exports
// ============================================

import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth } from "../auth/middleware.js";
import {
  handleListKeys,
  handleCreateKey,
  handleRevokeKey,
  handleGetMe,
} from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create dashboard router with all routes.
 */
export function createDashboardRouter(): Router {
  const router = Router();

  // Serve dashboard HTML (requires auth)
  router.get("/", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "views", "dashboard.html"));
  });

  // API routes (all require auth)
  router.get("/api/me", requireAuth, handleGetMe);
  router.get("/api/keys", requireAuth, handleListKeys);
  router.post("/api/keys", requireAuth, handleCreateKey);
  router.delete("/api/keys/:id", requireAuth, handleRevokeKey);

  return router;
}

/**
 * Create auth router for login/callback/logout.
 */
export function createAuthRouter(): Router {
  const router = Router();

  // Serve login page
  router.get("/login", (_req, res) => {
    res.sendFile(path.join(__dirname, "views", "login.html"));
  });

  return router;
}

// Re-export route handlers for testing
export { handleListKeys, handleCreateKey, handleRevokeKey, handleGetMe } from "./routes.js";
