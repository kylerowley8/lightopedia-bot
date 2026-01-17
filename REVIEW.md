# Lightopedia Code Review & Root Cause Analysis

## Project Overview

**Lightopedia** is a Slack bot that answers questions about the Light platform (B2B SaaS finance/billing system) using RAG (Retrieval-Augmented Generation). It indexes code and documentation, then uses semantic search + LLM synthesis to answer questions.

### Tech Stack
- **Runtime**: Node.js/TypeScript
- **Slack**: @slack/bolt
- **AI**: OpenAI GPT-4o (synthesis) + text-embedding-3-large (embeddings)
- **Database**: Supabase (PostgreSQL + pgvector)
- **Deployment**: Fly.io

### Core Architecture
```
User Question → Slack Event
    ↓
Query Expansion (OpenAI)
    ↓
Hybrid Search (Vector + Keyword)
    ↓
Source-Type Boost (code > docs > notion)
    ↓
LLM Reranking
    ↓
Answer Generation (GPT-4o with structured JSON output)
    ↓
Citation Gate (reject ungrounded answers)
    ↓
Slack Block Kit Response
```

---

## Goals / What We Want to Accomplish

1. **Answer questions about Light accurately** - using indexed code and docs as ground truth
2. **Prioritize code over docs** - answers should be grounded in actual implementation
3. **Be sales-safe** - avoid over-promising, use careful language patterns
4. **Support follow-up questions** - maintain conversational context within threads
5. **Prevent hallucinations** - citation gate ensures all claims are grounded
6. **Auto-index on code changes** - GitHub webhook triggers reindexing

---

## Bug History & Root Cause Analysis

### Bug #1: ESM/CommonJS Import Hell
**Commits**: `5f7dcde`, `c4ae47a`, `3072bb4`

**Symptom**: @slack/bolt wouldn't import properly in ESM context

**Root Cause**: @slack/bolt is CommonJS-only, but the project uses ESM (`"type": "module"`). Standard ES imports failed.

**Attempted Fixes**:
1. `import { App } from "@slack/bolt"` → Failed
2. `const { App } = require("@slack/bolt")` → Failed (require not defined in ESM)
3. `createRequire(import.meta.url)` → **Fixed**

**Final Solution** (server.ts:3-5):
```typescript
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { App, ExpressReceiver } = require("@slack/bolt");
```

**Lesson**: Mixed ESM/CJS ecosystems require shimming. Consider using `tsup` or similar bundler to normalize module formats.

---

### Bug #2: Terminology Confusion (Bills vs Contracts)
**Commit**: `9ef3662`

**Symptom**: Bot confused "bills" (supplier invoices) with "contracts" (customer agreements)

**Root Cause**: Light platform has distinct concepts:
- **Bills** = Supplier invoices (accounts payable)
- **Contracts** = Customer billing agreements (accounts receivable)

The indexed docs and code didn't clearly distinguish these, and the retrieval system pulled both when user asked about one.

**Fix**: Added explicit documentation (`docs/bills-supplier-invoices.md`) and potentially improved chunking/metadata to distinguish these domains.

**Lesson**: Domain terminology matters. Index should capture semantic distinctions, not just text similarity.

---

### Bug #3: Vector Search Timeouts
**Commit**: `b978d77`

**Symptom**: Queries hanging indefinitely or failing silently

**Root Cause**: Supabase RPC `match_chunks` had no timeout. Large vector indexes or slow DB connections caused queries to hang.

**Fix** (retrieve.ts:92-145):
```typescript
const VECTOR_RPC_TIMEOUT_MS = 5000;

const timeoutPromise = new Promise<null>((resolve) => {
  setTimeout(() => resolve(null), VECTOR_RPC_TIMEOUT_MS);
});
const result = await Promise.race([rpcPromise, timeoutPromise]);
```

**Lesson**: Always add timeouts to external service calls. Fail fast, not silent.

---

### Bug #4: Reranker Filtering Out All Keyword Results
**Commit**: `385a3f4`

**Symptom**: When vector search failed and keyword search returned results, reranker would filter out everything.

**Root Cause**: Keyword-only results had lower "similarity" scores (synthesized, not real embeddings). The reranker's minimum threshold filtered them all out.

**Fix**: When vector search is degraded, boost keyword result scores to pass threshold:
```typescript
if (vectorDegraded && keywordResults.length > 0) {
  mergedChunks = keywordResults.map((chunk) => ({
    ...chunk,
    similarity: Math.max(chunk.similarity, MIN_SIMILARITY + 0.05),
  }));
}
```

**Lesson**: Fallback paths need different thresholds. A "good" keyword result isn't the same as a "good" vector result.

---

### Bug #5: Overly Strict Confidence Scoring
**Commit**: `8b0952e`

**Symptom**: Too many "I don't know" responses even when relevant content existed

**Root Cause**: Multi-factor confidence scoring was too conservative. Required:
- High similarity (≥0.55)
- Multiple sources (≥2)
- High relevance score
- All bullets cited

This rejected answers that were actually useful.

**Fix**: Simplified confidence - trust the citation gate:
```typescript
// Simplified: if we have chunks with content, try to answer
// Citation gate protects against ungrounded answers
let isConfident = rankedChunks.length >= 1 && totalTokens >= 30;
```

**Lesson**: Don't stack defensive checks. One strong gate (citation validation) beats multiple weak heuristics.

---

### Bug #6: Lenient Confidence in Degraded Mode
**Commit**: `e012e18`

**Symptom**: When vector search timed out but keyword worked, confidence was too strict

**Root Cause**: Even when degraded, same strict confidence rules applied. But keyword-only is legitimately lower confidence.

**Fix**: Add `lowConfidenceReason` to explain degradation:
```typescript
if (vectorDegraded) {
  lowConfidenceReason = "Answer based on keyword search (vector search unavailable).";
}
```

**Lesson**: Be transparent about why confidence is lower. Don't hide it, explain it.

---

### Bug #7: Indexer Re-indexing Already Indexed Files
**Commit**: `bd4bbd5`

**Symptom**: Running indexer multiple times duplicated chunks

**Root Cause**: No check for existing document before inserting

**Fix**: Added `--force` flag to bypass "already indexed" check, with default behavior to skip existing:
```typescript
// Check if document exists first
const existing = await supabase.from("documents").select("id").eq("source", source);
if (existing.data?.length && !forceReindex) {
  return; // Skip
}
```

**Lesson**: Idempotency matters. Index operations should be safe to re-run.

---

## Open Challenges (User-Identified)

### Challenge #1: Not Reading Primarily from Kotlin Backend Code

**Current State**: The system has "code-first" retrieval implemented (retrieve.ts:304-324):
```typescript
if (codeChunks.length >= MIN_CODE_CHUNKS_FOR_CONFIDENCE) {
  chunksToRerank = codeChunks;
  retrievalMode = "code_only";
} else if (codeChunks.length > 0) {
  chunksToRerank = [...codeChunks, ...docsChunks.slice(...)];
  retrievalMode = "code_then_docs";
} else {
  chunksToRerank = docsChunks;
  retrievalMode = "docs_only";
}
```

**The Problem**: Despite this logic, answers often come from docs because:
1. **Embedding similarity favors prose over code** - Natural language questions match better with documentation text than Kotlin syntax
2. **Kotlin chunks may not be indexed** - Need to verify the Kotlin repo is actually being indexed
3. **Symbol extraction may not help retrieval** - Symbols are stored but not used in embedding or query expansion
4. **Code chunk boost (+0.05) is too small** - May not overcome similarity gap

**Root Causes**:
- Semantic embeddings are trained on prose, not code
- Questions are in English, code is in Kotlin
- No code-specific query transformation

**Potential Fixes**:
1. Index Kotlin with more context (add class docstrings, method signatures as separate searchable fields)
2. Use code-specific embeddings (CodeBERT, StarCoder embeddings)
3. Add a "code search" pass using symbols before embedding search
4. Increase code boost significantly (+0.15 or higher)
5. Fine-tune query expansion to generate code-like queries ("Invoice class", "markPaid function")

---

### Challenge #2: Threads Not Working

**Current State**: Thread support exists (server.ts:157, threadHistory.ts):
```typescript
const conversationHistory = await getThreadHistory(
  slackClient, e.channel, threadTs, e.ts, ctx.botUserId
);
// ... passed to answerQuestion
```

**The Problem**: User reports threads don't work. Potential issues:

1. **Thread detection failing** - `threadTs` may not be set correctly for all message types
2. **History not reaching LLM** - `formatConversationContext()` may return empty string
3. **Context not used in retrieval** - History is only appended to LLM prompt, not used to modify search
4. **Bot can't see its own messages** - `botUserId` may be undefined

**Root Causes** (likely):
```typescript
// threadHistory.ts:77-80
const isBotMessage =
  msg.bot_id !== undefined ||
  (botUserId !== undefined && msg.user === botUserId) ||  // ← botUserId may be undefined
  BOT_MESSAGE_SUBTYPES.includes(msg.subtype || "");
```

If `botUserId` is undefined, bot messages may be misclassified.

**Also**: `MAX_CONTEXT_MESSAGES = 6` may not capture enough history for long threads.

**Potential Fixes**:
1. Add logging to verify `botUserId` is populated
2. Add logging to verify thread history is fetched correctly
3. Increase `MAX_CONTEXT_MESSAGES`
4. Use thread history to augment the search query, not just the LLM prompt

---

### Challenge #3: Not Conversational Enough

**Current State**: The bot gives one-shot structured answers (summary + bullets + sources). It doesn't:
- Ask clarifying questions proactively (except when low confidence)
- Remember context across threads
- Engage in back-and-forth dialogue

**Root Causes**:
1. **Structured output format is rigid** - JSON schema forces summary+bullets+sources pattern
2. **No conversational state** - Each question is independent retrieval
3. **System prompt optimizes for accuracy over personality** - "sales-safe" language is dry
4. **Clarifying questions only triggered on low confidence** - Never proactively asks

**Potential Fixes**:
1. Add a "chat mode" vs "answer mode" - detect if user wants conversation vs lookup
2. Let the model sometimes skip structured output for natural responses
3. Add conversational phrases to system prompt
4. Use conversation history to skip repetitive context ("As I mentioned...")
5. Detect pronouns ("it", "that") and resolve from history before retrieval

---

## Architecture Rethink Considerations

### Current Architecture Limitations

1. **Single retrieval strategy** - Same pipeline for all questions
2. **Embedding-centric** - Code is a second-class citizen in embedding space
3. **Stateless** - No memory between questions (except within thread)
4. **One LLM call pattern** - Always structured output

### Alternative Architectures to Consider

#### Option A: Multi-Agent with Router
```
User Question
    ↓
Router Agent (classifies intent)
    ├─ "How does X work?" → Code Explorer Agent (reads Kotlin files)
    ├─ "Can Light do X?" → Capability Checker Agent (searches docs)
    ├─ "What about Y?" → Follow-up Agent (uses context)
    └─ Ambiguous → Clarifying Agent (asks questions)
```

**Pros**: Specialized handling, better code answers
**Cons**: More complexity, more latency

#### Option B: Code-First with Fallback
```
User Question
    ↓
Code Search (symbol matching, file grep, AST search)
    ↓
Found code? → LLM explains code directly
Not found? → Current embedding pipeline
```

**Pros**: Code answers grounded in actual source
**Cons**: Requires parsing/understanding code structure

#### Option C: Conversational Memory Layer
```
User Question
    ↓
Memory Layer (stores past Q&A, user preferences)
    ↓
Context Augmentation (retrieval + memory)
    ↓
LLM with conversational prompt (not just structured)
```

**Pros**: More natural, remembers context
**Cons**: Memory management complexity

#### Option D: Hybrid Embeddings
```
Question
    ├─ Text embeddings (current)
    └─ Code embeddings (CodeBERT/StarCoder)
        ↓
    Merge results with weighted scoring
```

**Pros**: Better code retrieval
**Cons**: Two embedding models, more cost

---

## Recommended Next Steps

### Immediate (Diagnostics)
1. Add detailed logging to thread handling to identify why threads fail
2. Verify Kotlin repo is indexed - run `checkSources.ts` and inspect
3. Log retrieval mode distribution - how often is it code_only vs docs_only?

### Short-term (Fixes)
1. Fix thread handling - ensure `botUserId` is always passed
2. Increase code boost to +0.15 or higher
3. Add symbol-based search pass before embedding search

### Medium-term (Architecture)
1. Implement Option B (code-first with fallback) for "how does X work" questions
2. Add conversational detection - skip structured output for casual questions
3. Use conversation history in retrieval, not just LLM prompt

### Long-term (Rethink)
1. Evaluate code-specific embeddings (requires benchmarking)
2. Consider multi-agent architecture for different question types
3. Add persistent memory for user preferences and past answers

---

## Files Referenced

| File | Purpose |
|------|---------|
| `src/server.ts` | Main Slack app, event handlers |
| `src/retrieval/retrieve.ts` | Hybrid search orchestration |
| `src/answer/generate.ts` | LLM answer synthesis, citation gate |
| `src/slack/threadHistory.ts` | Thread context fetching |
| `src/indexer/chunker.ts` | Document chunking with symbol extraction |
| `src/prompts/lightopediaSystem.ts` | System prompts |

---

*Generated: 2026-01-17*
