// ============================================
// Auth Middleware — Session-based authentication
// ============================================

import type { Request, Response, NextFunction } from "express";
import { getSessionFromRequest, type SessionPayload } from "./session.js";

export interface AuthenticatedDashboardRequest extends Request {
  session: SessionPayload;
}

/**
 * Middleware to require authentication for dashboard routes.
 * Redirects to login page if not authenticated.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const session = getSessionFromRequest(req);

  if (!session) {
    // For API requests, return JSON error
    if (req.path.startsWith("/dashboard/api/")) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Session expired or invalid. Please log in again.",
      });
      return;
    }

    // For page requests, redirect to login
    res.redirect("/auth/login");
    return;
  }

  // Attach session to request
  (req as AuthenticatedDashboardRequest).session = session;
  next();
}

/**
 * Middleware to optionally attach session if present.
 * Does not require authentication.
 */
export function attachSession(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const session = getSessionFromRequest(req);
  if (session) {
    (req as AuthenticatedDashboardRequest).session = session;
  }
  next();
}
