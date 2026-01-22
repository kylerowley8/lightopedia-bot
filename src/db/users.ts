// ============================================
// User CRUD Operations
// ============================================

import { supabase } from "./supabase.js";
import { logger } from "../lib/logger.js";

export interface User {
  id: string;
  email: string;
  google_id: string;
  name: string | null;
  picture_url: string | null;
  created_at: string;
  last_login_at: string;
}

export interface CreateUserInput {
  email: string;
  googleId: string;
  name?: string;
  pictureUrl?: string;
}

/**
 * Find a user by Google ID.
 */
export async function findUserByGoogleId(googleId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("google_id", googleId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows returned
    logger.error("Error finding user by Google ID", {
      stage: "db",
      error: error.message,
    });
    return null;
  }

  return data as User | null;
}

/**
 * Find a user by ID.
 */
export async function findUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") {
    logger.error("Error finding user by ID", {
      stage: "db",
      error: error.message,
    });
    return null;
  }

  return data as User | null;
}

/**
 * Create a new user.
 */
export async function createUser(input: CreateUserInput): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .insert({
      email: input.email,
      google_id: input.googleId,
      name: input.name || null,
      picture_url: input.pictureUrl || null,
    })
    .select()
    .single();

  if (error) {
    logger.error("Error creating user", {
      stage: "db",
      error: error.message,
    });
    return null;
  }

  logger.info("User created", {
    stage: "db",
    userId: data.id,
    email: input.email,
  });

  return data as User;
}

/**
 * Update user's last login timestamp.
 */
export async function updateLastLogin(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    logger.error("Error updating last login", {
      stage: "db",
      userId,
      error: error.message,
    });
  }
}

/**
 * Find or create a user from Google OAuth data.
 * Updates last_login_at if user already exists.
 */
export async function findOrCreateUser(input: CreateUserInput): Promise<User | null> {
  // Try to find existing user
  const existingUser = await findUserByGoogleId(input.googleId);

  if (existingUser) {
    // Update last login
    await updateLastLogin(existingUser.id);
    return { ...existingUser, last_login_at: new Date().toISOString() };
  }

  // Create new user
  return createUser(input);
}
