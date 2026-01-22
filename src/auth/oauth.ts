// ============================================
// Auth Handlers — Email/Password via Supabase Auth
// ============================================

import type { Request, Response } from "express";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { createServerSupabase, setSessionCookies, clearSessionCookies } from "./session.js";

const ALLOWED_DOMAIN = "light.inc";

/**
 * Handle POST /auth/signup — Create a new account.
 */
export async function handleSignup(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required" });
    return;
  }

  // Validate @light.inc email
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    res.status(400).json({ message: "Only @light.inc email addresses are allowed" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ message: "Password must be at least 8 characters" });
    return;
  }

  const supabase = createServerSupabase();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    logger.error("Signup failed", {
      stage: "auth",
      error: error.message,
    });
    res.status(400).json({ message: error.message });
    return;
  }

  // Check if email confirmation is required
  if (data.user && !data.session) {
    logger.info("User signed up, confirmation required", {
      stage: "auth",
      email,
    });
    res.json({ confirmEmail: true });
    return;
  }

  // If session exists, set cookies and redirect
  if (data.session) {
    setSessionCookies(
      res,
      data.session.access_token,
      data.session.refresh_token,
      data.session.expires_in
    );

    logger.info("User signed up and logged in", {
      stage: "auth",
      userId: data.user?.id,
      email,
    });

    res.json({ success: true });
    return;
  }

  res.status(500).json({ message: "Unexpected error during signup" });
}

/**
 * Handle POST /auth/signin — Sign in with email/password.
 */
export async function handleSignin(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required" });
    return;
  }

  // Validate @light.inc email
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    res.status(400).json({ message: "Only @light.inc email addresses are allowed" });
    return;
  }

  const supabase = createServerSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    logger.warn("Signin failed", {
      stage: "auth",
      email,
      error: error.message,
    });
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  if (!data.session) {
    res.status(401).json({ message: "Authentication failed" });
    return;
  }

  setSessionCookies(
    res,
    data.session.access_token,
    data.session.refresh_token,
    data.session.expires_in
  );

  logger.info("User signed in", {
    stage: "auth",
    userId: data.user.id,
    email,
  });

  res.json({ success: true });
}

/**
 * Handle POST /auth/logout — Clear session.
 */
export async function handleLogout(_req: Request, res: Response): Promise<void> {
  clearSessionCookies(res);
  res.redirect("/auth/login");
}

// Keep these for backward compatibility (Google OAuth)
export function handleLogin(_req: Request, res: Response): void {
  res.redirect("/auth/login");
}

export async function handleCallback(req: Request, res: Response): Promise<void> {
  res.redirect("/auth/login?error=Google OAuth not configured");
}
