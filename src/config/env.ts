import { z } from "zod";

// ============================================
// Environment configuration with validation
// Fails fast on startup if config is invalid
// ============================================

const envSchema = z.object({
  // Server
  PORT: z.string().default("3000").transform(Number),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  USE_V2: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  // Slack
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
  SLACK_SIGNING_SECRET: z.string().min(1, "SLACK_SIGNING_SECRET is required"),

  // Supabase
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),

  // Firecrawl (optional - for live article scraping)
  FIRECRAWL_API_KEY: z.string().optional(),

  // GitHub (optional - only needed if using GitHub webhook)
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(), // For indexing scripts

  // API Configuration (optional - only needed if exposing public API)
  API_KEYS: z.string().optional(), // Comma-separated: "id1:name1:secret1,id2:name2:secret2"
  API_RATE_LIMIT_WINDOW_MS: z.string().default("60000").transform(Number), // 1 minute default
  API_RATE_LIMIT_MAX_REQUESTS: z.string().default("20").transform(Number), // 20 req/min default
  API_ALLOWED_ORIGINS: z.string().default(""), // Comma-separated origins, or "*" for all

  // Dashboard (optional - redirect URI for OAuth callback, dashboard enabled if Supabase is configured)
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

// Validate on module load
export const env = validateEnv();

/**
 * Parse API keys from environment variable.
 * Format: "id1:name1:secret1,id2:name2:secret2"
 */
function parseApiKeys(
  keysStr: string | undefined
): Array<{ id: string; name: string; secret: string }> {
  if (!keysStr) return [];

  return keysStr
    .split(",")
    .map((keyStr) => {
      const [id, name, secret] = keyStr.trim().split(":");
      if (!id || !name || !secret) return null;
      return { id, name, secret };
    })
    .filter((k): k is { id: string; name: string; secret: string } => k !== null);
}

/**
 * Parse allowed origins from environment variable.
 */
function parseAllowedOrigins(originsStr: string): string[] {
  if (!originsStr) return [];
  return originsStr.split(",").map((o) => o.trim()).filter(Boolean);
}

// Derived config for convenience
export const config = {
  port: env.PORT,
  isDev: env.NODE_ENV === "development",
  isProd: env.NODE_ENV === "production",
  useV2: env.USE_V2,

  slack: {
    botToken: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
  },

  supabase: {
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  },

  openai: {
    apiKey: env.OPENAI_API_KEY,
  },

  github: {
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    isConfigured: Boolean(env.GITHUB_WEBHOOK_SECRET && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY),
  },

  api: {
    keys: parseApiKeys(env.API_KEYS),
    rateLimitWindowMs: env.API_RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: env.API_RATE_LIMIT_MAX_REQUESTS,
    allowedOrigins: parseAllowedOrigins(env.API_ALLOWED_ORIGINS),
    isConfigured: Boolean(env.API_KEYS && env.API_KEYS.length > 0),
  },

  googleOAuth: {
    redirectUri: env.GOOGLE_REDIRECT_URI,
  },

  // Dashboard is enabled when Supabase is configured (Google OAuth configured in Supabase Dashboard)
  dashboardEnabled: true,
} as const;
