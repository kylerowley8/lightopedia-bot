// ============================================
// Test Setup — Mock external services
// ============================================

import { vi } from "vitest";

// Mock environment variables
process.env.OPENAI_API_KEY = "test-key";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.SLACK_SIGNING_SECRET = "test-secret";

// Mock OpenAI
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    mode: "capability_docs",
                    confidence: "high",
                  }),
                },
              },
            ],
          }),
        },
      };
      embeddings = {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0) }],
        }),
      };
    },
  };
});

// Mock Supabase
vi.mock("../src/db/supabase.js", () => {
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    },
  };
});

// Mock logger to suppress output during tests
vi.mock("../src/lib/logger.js", () => {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    createRequestLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});
