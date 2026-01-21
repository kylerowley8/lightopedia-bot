# Lightopedia MCP Server

Query Lightopedia - Light's AI knowledge assistant - from Claude Desktop or Claude Code.

## Setup

### 1. Get an API Key

Request a Lightopedia API key from the platform team.

### 2. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lightopedia": {
      "command": "node",
      "args": ["/path/to/lightopedia-bot/mcp-server/dist/index.js"],
      "env": {
        "LIGHTOPEDIA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### 3. Configure Claude Code

Add to your project's `.mcp.json` or global `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "lightopedia": {
      "command": "node",
      "args": ["/path/to/lightopedia-bot/mcp-server/dist/index.js"],
      "env": {
        "LIGHTOPEDIA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Usage

Once configured, you can ask Claude:

> "Use Lightopedia to find out how invoice payments work"

Or Claude will automatically use it when you ask about Light's platform.

## Tool: `ask_lightopedia`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | Yes | The question to ask (1-2000 chars) |
| `conversationHistory` | array | No | Previous Q&A for follow-ups |
| `includeEvidence` | boolean | No | Include source counts in response |

### Example Response

```
Invoice payments in Light are processed through the Accounts Receivable (AR) module...

**Confidence:** Verified from code

**Sources:**
- docs: /invoicing/payments.md
- code: services/billing/paymentProcessor.ts

_Request: abc123 | Mode: synthesis | 1234ms_
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTOPEDIA_API_KEY` | (required) | API key for authentication |
| `LIGHTOPEDIA_URL` | `https://lightopedia.fly.dev` | API base URL |

## Development

```bash
npm install
npm run build
npm run dev  # Uses tsx for development
```
