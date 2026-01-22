// ============================================
// Session Management — HMAC-signed JWT cookies
// ============================================

import crypto from "crypto";
import type { Response, Request } from "express";
import { config } from "../config/env.js";

const COOKIE_NAME = "lightopedia_session";
const SESSION_EXPIRY_DAYS = 7;
const SESSION_EXPIRY_MS = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  email: string;
  name?: string;
  pictureUrl?: string;
  exp: number; // Expiration timestamp
}

/**
 * Create an HMAC signature for a payload.
 */
function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Verify an HMAC signature.
 */
function verify(payload: string, signature: string, secret: string): boolean {
  const expected = sign(payload, secret);
  // Use timing-safe comparison
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Create a session token (base64url encoded payload + signature).
 */
export function createSessionToken(data: Omit<SessionPayload, "exp">): string {
  const secret = config.session.secret;
  if (!secret) throw new Error("SESSION_SECRET not configured");

  const payload: SessionPayload = {
    ...data,
    exp: Date.now() + SESSION_EXPIRY_MS,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadStr, secret);

  return `${payloadStr}.${signature}`;
}

/**
 * Verify and decode a session token.
 * Returns null if invalid or expired.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  const secret = config.session.secret;
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) return null;

  // Verify signature
  if (!verify(payloadStr, signature, secret)) {
    return null;
  }

  // Decode payload
  try {
    const payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf8")
    ) as SessionPayload;

    // Check expiration
    if (payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Set session cookie on response.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    maxAge: SESSION_EXPIRY_MS,
    path: "/",
  });
}

/**
 * Clear session cookie.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Get session from request cookies.
 */
export function getSessionFromRequest(req: Request): SessionPayload | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  const token = cookies?.[COOKIE_NAME];

  if (!token) return null;

  return verifySessionToken(token);
}
