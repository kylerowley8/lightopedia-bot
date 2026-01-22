// ============================================
// Google OAuth via Supabase Auth
// ============================================

import type { Request, Response } from "express";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { createServerSupabase, setSessionCookies, clearSessionCookies } from "./session.js";

const ALLOWED_DOMAIN = "light.inc";

/**
 * Handle GET /auth/login — Redirect to Supabase OAuth.
 */
export function handleLogin(_req: Request, res: Response): void {
  const supabase = createServerSupabase();

  // Build the OAuth URL
  const redirectTo = `${config.supabase.url}/auth/v1/authorize?` +
    new URLSearchParams({
      provider: "google",
      redirect_to: config.googleOAuth.redirectUri || `${getBaseUrl()}/auth/callback`,
      hd: ALLOWED_DOMAIN, // Hint to Google to show only @light.inc accounts
    }).toString();

  res.redirect(redirectTo);
}

/**
 * Handle GET /auth/callback — OAuth callback from Supabase.
 */
export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, error, error_description } = req.query as {
    code?: string;
    error?: string;
    error_description?: string;
  };

  // Check for OAuth error
  if (error) {
    logger.warn("OAuth error from Supabase", {
      stage: "auth",
      error,
      description: error_description,
    });
    res.redirect(`/auth/login?error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code) {
    res.redirect("/auth/login?error=no_code");
    return;
  }

  const supabase = createServerSupabase();

  // Exchange code for session
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !data.session) {
    logger.error("Failed to exchange code for session", {
      stage: "auth",
      error: exchangeError?.message,
    });
    res.redirect("/auth/login?error=exchange_failed");
    return;
  }

  const { session, user } = data;

  // Verify email domain (server-side check)
  if (!user.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
    logger.warn("OAuth rejected: invalid domain", {
      stage: "auth",
      email: user.email,
    });

    // Sign out the user since they're not allowed
    await supabase.auth.signOut();

    res.redirect("/auth/login?error=invalid_domain");
    return;
  }

  // Set session cookies
  setSessionCookies(
    res,
    session.access_token,
    session.refresh_token,
    session.expires_in
  );

  logger.info("User logged in via Supabase", {
    stage: "auth",
    userId: user.id,
    email: user.email,
  });

  // Redirect to dashboard
  res.redirect("/dashboard");
}

/**
 * Handle POST /auth/logout — Clear session.
 */
export async function handleLogout(_req: Request, res: Response): Promise<void> {
  clearSessionCookies(res);
  res.redirect("/auth/login");
}

/**
 * Get base URL from config or default.
 */
function getBaseUrl(): string {
  // In production, use the known URL
  if (config.isProd) {
    return "https://lightopedia.fly.dev";
  }
  return `http://localhost:${config.port}`;
}
