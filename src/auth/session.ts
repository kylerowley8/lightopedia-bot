// ============================================
// Session Management — Supabase Auth
// ============================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { config } from "../config/env.js";

const COOKIE_NAME = "sb-access-token";
const REFRESH_COOKIE_NAME = "sb-refresh-token";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  pictureUrl?: string;
}

/**
 * Create a Supabase client for server-side auth operations.
 */
export function createServerSupabase(): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Parse session cookies from request.
 */
function getTokensFromCookies(req: Request): { accessToken?: string; refreshToken?: string } {
  const cookies = req.cookies as Record<string, string> | undefined;
  return {
    accessToken: cookies?.[COOKIE_NAME],
    refreshToken: cookies?.[REFRESH_COOKIE_NAME],
  };
}

/**
 * Set session cookies on response.
 */
export function setSessionCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): void {
  const cookieOptions = {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax" as const,
    path: "/",
  };

  res.cookie(COOKIE_NAME, accessToken, {
    ...cookieOptions,
    maxAge: expiresIn * 1000,
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * Clear session cookies.
 */
export function clearSessionCookies(res: Response): void {
  const cookieOptions = {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax" as const,
    path: "/",
  };

  res.clearCookie(COOKIE_NAME, cookieOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
}

/**
 * Get session user from request cookies.
 * Returns null if not authenticated or session expired.
 */
export async function getSessionFromRequest(req: Request): Promise<SessionUser | null> {
  const { accessToken, refreshToken } = getTokensFromCookies(req);

  if (!accessToken) {
    return null;
  }

  const supabase = createServerSupabase();

  // Verify the access token
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    // Try refresh if we have a refresh token
    if (refreshToken) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (!refreshError && refreshData.user && refreshData.session) {
        // Return user but note: cookies won't be updated here
        // The middleware should handle setting new cookies
        const metadata = refreshData.user.user_metadata as Record<string, unknown> | undefined;
        return {
          id: refreshData.user.id,
          email: refreshData.user.email!,
          name: metadata?.["full_name"] as string | undefined,
          pictureUrl: metadata?.["avatar_url"] as string | undefined,
        };
      }
    }
    return null;
  }

  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  return {
    id: user.id,
    email: user.email!,
    name: metadata?.["full_name"] as string | undefined,
    pictureUrl: metadata?.["avatar_url"] as string | undefined,
  };
}
