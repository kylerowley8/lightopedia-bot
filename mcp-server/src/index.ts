#!/usr/bin/env node
// ============================================
// Lightopedia MCP Server
// Query Light's knowledge base from Claude Desktop/Code
// ============================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ============================================
// Configuration
// ============================================

const LIGHTOPEDIA_BASE_URL =
  process.env.LIGHTOPEDIA_URL ?? "https://lightopedia.fly.dev";
const LIGHTOPEDIA_API_KEY = process.env.LIGHTOPEDIA_API_KEY ?? "";

// ============================================
// Types
// ============================================

interface AskParams {
  question: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  includeEvidence?: boolean;
}

interface AskResponse {
  requestId: string;
  answer: {
    summary: string;
    confidence: "confirmed_implementation" | "confirmed_docs" | "needs_clarification";
    claims: Array<{
      text: string;
      citations: Array<{ type: string; ref: string }>;
    }>;
  };
  metadata: {
    mode: string;
    latencyMs: number;
    routerVersion: string;
    pipelineVersion: string;
  };
  evidence?: {
    docsCount: number;
    codeChunksCount: number;
    slackThreadsCount: number;
    topSources: Array<{ type: string; path: string; similarity: number }>;
  };
}

interface ApiError {
  error: string;
  message: string;
  requestId?: string;
}

// ============================================
// Tool Definition
// ============================================

const ASK_TOOL: Tool = {
  name: "ask_lightopedia",
  description: `Query Lightopedia - Light's AI knowledge assistant.

Ask questions about Light's platform including:
- Product features and functionality
- Technical implementation details
- API documentation and usage
- Internal processes and workflows
- Code architecture and patterns

Returns an answer with confidence level and source citations.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      question: {
        type: "string",
        description: "The question to ask about Light's platform (1-2000 characters)",
      },
      conversationHistory: {
        type: "array",
        description: "Optional conversation history for follow-up questions",
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: ["user", "assistant"],
            },
            content: {
              type: "string",
            },
          },
          required: ["role", "content"],
        },
      },
      includeEvidence: {
        type: "boolean",
        description: "Include detailed evidence breakdown (doc/code/thread counts)",
        default: false,
      },
    },
    required: ["question"],
  },
};

// ============================================
// API Client
// ============================================

async function askLightopedia(params: AskParams): Promise<string> {
  if (!LIGHTOPEDIA_API_KEY) {
    return "Error: LIGHTOPEDIA_API_KEY environment variable not set. Please configure it in your Claude Desktop settings.";
  }

  const url = `${LIGHTOPEDIA_BASE_URL}/api/v1/ask`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LIGHTOPEDIA_API_KEY}`,
      },
      body: JSON.stringify({
        question: params.question,
        conversationHistory: params.conversationHistory,
        options: {
          includeEvidence: params.includeEvidence ?? false,
        },
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      return `Error (${response.status}): ${error.message}`;
    }

    const data = (await response.json()) as AskResponse;
    return formatResponse(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error connecting to Lightopedia: ${message}`;
  }
}

function formatResponse(data: AskResponse): string {
  const lines: string[] = [];

  // Answer
  lines.push(data.answer.summary);
  lines.push("");

  // Confidence indicator
  const confidenceLabel = {
    confirmed_implementation: "Verified from code",
    confirmed_docs: "Verified from documentation",
    needs_clarification: "May need clarification",
  }[data.answer.confidence];
  lines.push(`**Confidence:** ${confidenceLabel}`);

  // Citations
  const allCitations = data.answer.claims.flatMap((c) => c.citations);
  if (allCitations.length > 0) {
    const uniqueCitations = [...new Set(allCitations.map((c) => `${c.type}: ${c.ref}`))];
    lines.push("");
    lines.push("**Sources:**");
    uniqueCitations.slice(0, 5).forEach((citation) => {
      lines.push(`- ${citation}`);
    });
  }

  // Evidence (if included)
  if (data.evidence) {
    lines.push("");
    lines.push(
      `**Evidence:** ${data.evidence.docsCount} docs, ${data.evidence.codeChunksCount} code chunks, ${data.evidence.slackThreadsCount} Slack threads`
    );
  }

  // Metadata
  lines.push("");
  lines.push(`_Request: ${data.requestId} | Mode: ${data.metadata.mode} | ${data.metadata.latencyMs}ms_`);

  return lines.join("\n");
}

// ============================================
// Server Setup
// ============================================

const server = new Server(
  {
    name: "lightopedia-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [ASK_TOOL],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "ask_lightopedia") {
    const params = (args ?? {}) as unknown as AskParams;

    if (!params.question || typeof params.question !== "string") {
      return {
        content: [{ type: "text", text: "Error: 'question' parameter is required" }],
        isError: true,
      };
    }

    if (params.question.length > 2000) {
      return {
        content: [{ type: "text", text: "Error: Question cannot exceed 2000 characters" }],
        isError: true,
      };
    }

    const result = await askLightopedia(params);
    return {
      content: [{ type: "text", text: result }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ============================================
// Main
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Lightopedia MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
