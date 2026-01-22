// ============================================
// API Key CRUD Operations + Validation
// ============================================

import crypto from "crypto";
import { supabase } from "./supabase.js";
import { logger } from "../lib/logger.js";

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeyDisplay {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  isRevoked: boolean;
}

export interface CreateApiKeyResult {
  key: ApiKeyDisplay;
  rawKey: string; // Only returned on creation, never stored
}

/**
 * Generate a secure random API key.
 * Format: lp_<32 random hex chars> = 35 chars total
 */
function generateApiKey(): string {
  const randomPart = crypto.randomBytes(16).toString("hex");
  return `lp_${randomPart}`;
}

/**
 * Hash an API key using SHA256.
 */
function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Extract the display prefix from a key (first 12 chars).
 */
function getKeyPrefix(key: string): string {
  return key.slice(0, 12) + "...";
}

/**
 * Create a new API key for a user.
 * Returns the raw key (only shown once) along with the stored key info.
 */
export async function createApiKey(
  userId: string,
  name: string
): Promise<CreateApiKeyResult | null> {
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: userId,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
    })
    .select()
    .single();

  if (error) {
    logger.error("Error creating API key", {
      stage: "db",
      userId,
      error: error.message,
    });
    return null;
  }

  logger.info("API key created", {
    stage: "db",
    userId,
    keyId: data.id,
    keyPrefix,
  });

  return {
    key: {
      id: data.id,
      name: data.name,
      keyPrefix: data.key_prefix,
      lastUsedAt: data.last_used_at,
      createdAt: data.created_at,
      isRevoked: data.revoked_at !== null,
    },
    rawKey,
  };
}

/**
 * List all API keys for a user (active and revoked).
 */
export async function listUserApiKeys(userId: string): Promise<ApiKeyDisplay[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, created_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Error listing API keys", {
      stage: "db",
      userId,
      error: error.message,
    });
    return [];
  }

  return (data || []).map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    lastUsedAt: k.last_used_at,
    createdAt: k.created_at,
    isRevoked: k.revoked_at !== null,
  }));
}

/**
 * Revoke an API key.
 * Only allows revoking keys owned by the specified user.
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  const { error, count } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (error) {
    logger.error("Error revoking API key", {
      stage: "db",
      keyId,
      userId,
      error: error.message,
    });
    return false;
  }

  if (count === 0) {
    logger.warn("API key not found or already revoked", {
      stage: "db",
      keyId,
      userId,
    });
    return false;
  }

  logger.info("API key revoked", {
    stage: "db",
    keyId,
    userId,
  });

  return true;
}

/**
 * Validate an API key from the database.
 * Returns user/key info if valid, null otherwise.
 * Also updates last_used_at timestamp.
 */
export async function validateDbApiKey(
  providedKey: string
): Promise<{ keyId: string; keyName: string; userId: string } | null> {
  const keyHash = hashApiKey(providedKey);

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, user_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .single();

  if (error || !data) {
    return null;
  }

  // Update last_used_at asynchronously (don't block the request)
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(({ error: updateError }) => {
      if (updateError) {
        logger.warn("Failed to update last_used_at", {
          stage: "db",
          keyId: data.id,
          error: updateError.message,
        });
      }
    });

  return {
    keyId: data.id,
    keyName: data.name,
    userId: data.user_id,
  };
}
