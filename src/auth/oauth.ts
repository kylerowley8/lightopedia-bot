// ============================================
// Google OAuth Flow
// ============================================

import type { Request, Response } from "express";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { findOrCreateUser } from "../db/users.js";
import { createSessionToken, setSessionCookie } from "./session.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const ALLOWED_DOMAIN = "light.inc";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  hd?: string; // Hosted domain (for Google Workspace accounts)
}

/**
 * Build Google OAuth authorization URL.
 */
function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.googleOAuth.clientId!,
    redirect_uri: config.googleOAuth.redirectUri!,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    state,
    hd: ALLOWED_DOMAIN, // Hint to Google to only show @light.inc accounts
    prompt: "select_account",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token.
 */
async function exchangeCodeForToken(code: string): Promise<GoogleTokenResponse | null> {
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.googleOAuth.clientId!,
        client_secret: config.googleOAuth.clientSecret!,
        redirect_uri: config.googleOAuth.redirectUri!,
        grant_type: "authorization_code",
        code,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error("Google token exchange failed", {
        stage: "auth",
        status: response.status,
        body: text,
      });
      return null;
    }

    return (await response.json()) as GoogleTokenResponse;
  } catch (err) {
    logger.error("Google token exchange error", {
      stage: "auth",
      error: err,
    });
    return null;
  }
}

/**
 * Fetch user info from Google using access token.
 */
async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      logger.error("Google userinfo fetch failed", {
        stage: "auth",
        status: response.status,
      });
      return null;
    }

    return (await response.json()) as GoogleUserInfo;
  } catch (err) {
    logger.error("Google userinfo fetch error", {
      stage: "auth",
      error: err,
    });
    return null;
  }
}

/**
 * Handle GET /auth/login — Redirect to Google OAuth.
 */
export function handleLogin(req: Request, res: Response): void {
  if (!config.googleOAuth.isConfigured) {
    res.status(503).json({
      error: "OAUTH_NOT_CONFIGURED",
      message: "Google OAuth is not configured",
    });
    return;
  }

  // Generate state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in a short-lived cookie for verification
  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: "/",
  });

  const authUrl = buildAuthUrl(state);
  res.redirect(authUrl);
}

/**
 * Handle GET /auth/callback — OAuth callback, set session cookie.
 */
export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  // Check for OAuth error
  if (error) {
    logger.warn("OAuth error from Google", { stage: "auth", error });
    res.redirect("/auth/login?error=oauth_denied");
    return;
  }

  // Verify state (CSRF protection)
  const cookies = req.cookies as Record<string, string> | undefined;
  const storedState = cookies?.["oauth_state"];

  if (!state || !storedState || state !== storedState) {
    logger.warn("OAuth state mismatch", { stage: "auth" });
    res.redirect("/auth/login?error=invalid_state");
    return;
  }

  // Clear state cookie
  res.clearCookie("oauth_state", { path: "/" });

  if (!code) {
    res.redirect("/auth/login?error=no_code");
    return;
  }

  // Exchange code for token
  const tokenData = await exchangeCodeForToken(code);
  if (!tokenData) {
    res.redirect("/auth/login?error=token_exchange_failed");
    return;
  }

  // Fetch user info
  const userInfo = await fetchUserInfo(tokenData.access_token);
  if (!userInfo) {
    res.redirect("/auth/login?error=userinfo_failed");
    return;
  }

  // Verify email domain (server-side check, don't trust hd parameter alone)
  if (!userInfo.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    logger.warn("OAuth rejected: invalid domain", {
      stage: "auth",
      email: userInfo.email,
    });
    res.redirect("/auth/login?error=invalid_domain");
    return;
  }

  // Find or create user in database
  const user = await findOrCreateUser({
    email: userInfo.email,
    googleId: userInfo.id,
    name: userInfo.name,
    pictureUrl: userInfo.picture,
  });

  if (!user) {
    res.redirect("/auth/login?error=user_creation_failed");
    return;
  }

  // Create session token and set cookie
  const sessionToken = createSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name ?? undefined,
    pictureUrl: user.picture_url ?? undefined,
  });

  setSessionCookie(res, sessionToken);

  logger.info("User logged in", {
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
export function handleLogout(_req: Request, res: Response): void {
  import("./session.js").then(({ clearSessionCookie }) => {
    clearSessionCookie(res);
    res.redirect("/auth/login");
  });
}

// Need crypto for state generation
import crypto from "crypto";
