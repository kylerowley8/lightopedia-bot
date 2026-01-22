// ============================================
// Auth Middleware — Supabase session-based authentication
// ============================================

import type { Request, Response, NextFunction } from "express";
import { getSessionFromRequest, type SessionUser } from "./session.js";

export interface AuthenticatedDashboardRequest extends Request {
  user: SessionUser;
}

/**
 * Middleware to require authentication for dashboard routes.
 * Redirects to login page if not authenticated.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await getSessionFromRequest(req);

  if (!user) {
    // For API requests, return JSON error
    if (req.path.startsWith("/api/")) {
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

  // Attach user to request
  (req as AuthenticatedDashboardRequest).user = user;
  next();
}
