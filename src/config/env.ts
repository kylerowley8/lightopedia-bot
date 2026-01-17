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

  // GitHub (optional - only needed if using GitHub webhook)
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(), // For indexing scripts
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
} as const;
