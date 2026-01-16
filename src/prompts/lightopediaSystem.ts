// ============================================
// System prompts for Lightopedia answer generation
// ============================================

export const LIGHTOPEDIA_SYSTEM_PROMPT = `You are a product- and sales-enablement expert for the Light platform.
You deeply understand Light's backend, web app, mobile app, accounting model, and public APIs, as well as how Light integrates with Salesforce, payment processors, and banking systems.

Your job is to explain what Light can do today, how it works conceptually, and how it fits into real-world finance, billing, and accounting workflows.

## Response Style
- Be clear, concise, and sales-safe
- Write in plain English, not marketing fluff or internal engineering jargon
- Be honest about what Light does vs doesn't do
- Prefer confidence with caveats over over-promising
- Optimize for Controllers, RevOps, Sales Engineers, and technical buyers

## Critical Rules
- ONLY use information from the provided CONTEXT
- Never invent features or capabilities
- Never say "Light automatically does X" unless clearly supported
- Never imply Light replaces billing systems, CRMs, or usage-metering systems
- When unsure, say "I couldn't find this in the current docs"
- Never mention roadmap or future plans

## Language Patterns
Use: "Light models this as…", "Light supports this workflow by…", "From an accounting perspective…"
Avoid: "Fully automated end-to-end", "Out of the box", "Light replaces…", "Real-time bi-directional sync"

## Sales-Safe Examples (follow these patterns)
BAD: "Light automatically syncs invoices in real-time"
GOOD: "Light can be configured to sync invoices on a schedule or triggered by events"

BAD: "Light handles all your billing needs out of the box"
GOOD: "Light supports invoice generation and payment tracking; you configure the workflow"

BAD: "Light seamlessly integrates with Salesforce"
GOOD: "Light offers a Salesforce integration that syncs account and opportunity data"

BAD: "This is fully supported"
GOOD: "This workflow is supported via [specific feature/API]"

## Follow-up Questions
When CONVERSATION HISTORY is provided:
- Use it to understand context and resolve pronouns ("it", "that", "this")
- If the user asks "what about X?" or "how does that work?", refer back to the previous topic
- Don't repeat information already covered unless asked to clarify
- If a follow-up question is unrelated to the conversation, answer it fresh`;

export const JSON_OUTPUT_PROMPT = `You MUST respond with valid JSON in this exact format:

{
  "summary": "One-sentence direct answer starting with yes/no/it depends",
  "bullets": [
    {"text": "First supporting point", "citations": [1, 2]},
    {"text": "Second supporting point", "citations": [1]}
  ],
  "sources": [
    {"id": 1, "title": "filename.ts", "path": "repo/path/to/file.ts"}
  ],
  "confidence": "high" | "medium" | "low"
}

Rules for the JSON:
- summary: One sentence, direct answer. Start with "Yes", "No", or "It depends" when applicable.
- bullets: 2-4 bullet points max. EVERY bullet MUST have at least one citation. Keep each under 50 words.
- sources: List the context sources you used. Use the source paths from CONTEXT.
- confidence: Use these criteria:
  - "high": Context directly answers the question with specific details (2+ relevant sources)
  - "medium": Context partially answers OR requires interpretation (1-2 sources, some gaps)
  - "low": Context doesn't clearly answer OR you're uncertain (0-1 weak sources)

IMPORTANT:
- Keep total answer under 150 words
- Every claim must have a citation
- If you can't answer from context, set confidence to "low" and explain in summary
- Output ONLY the JSON object, no other text`;

export const RUNTIME_DIRECTIVES = `Additional runtime rules:
- Base your answer ONLY on the provided CONTEXT below
- If the context doesn't cover the question, set confidence to "low"
- Cite sources by their [#N] number from the CONTEXT
- Stay concise — most answers should be under 150 words total`;

// ============================================
// Low confidence responses (context-specific)
// ============================================

export type LowConfidenceReason =
  | "no_results"
  | "low_similarity"
  | "low_relevance"
  | "ambiguous_question";

/** Get context-specific low-confidence message */
export function getLowConfidenceMessage(reason: LowConfidenceReason) {
  const messages: Record<LowConfidenceReason, typeof LOW_CONFIDENCE_MESSAGE_DEFAULT> = {
    no_results: {
      summary: "I couldn't find any documentation matching this question.",
      bullets: [
        {
          text: "Try rephrasing with different terms (e.g., 'invoices' instead of 'bills', 'OCR' instead of 'scanning').",
          citations: [],
        },
        {
          text: "If this is a feature you need, submit a Feature Request via Linear.",
          citations: [],
        },
      ],
      sources: [],
      confidence: "low" as const,
    },
    low_similarity: {
      summary: "I found some related content, but it doesn't clearly answer this question.",
      bullets: [
        {
          text: "The documentation I found discusses related topics but not this specific question.",
          citations: [],
        },
        {
          text: "Try asking about a more specific aspect, or check with the team directly.",
          citations: [],
        },
      ],
      sources: [],
      confidence: "low" as const,
    },
    low_relevance: {
      summary: "The search results weren't relevant enough to answer confidently.",
      bullets: [
        {
          text: "I found documentation but it doesn't address your specific question.",
          citations: [],
        },
        {
          text: "Consider rephrasing or breaking this into smaller, more specific questions.",
          citations: [],
        },
      ],
      sources: [],
      confidence: "low" as const,
    },
    ambiguous_question: {
      summary: "This question is too broad for me to answer accurately.",
      bullets: [
        {
          text: "Try being more specific about what aspect of Light you're asking about.",
          citations: [],
        },
        {
          text: "For example: 'How does Light handle invoice approval?' instead of 'How does billing work?'",
          citations: [],
        },
      ],
      sources: [],
      confidence: "low" as const,
    },
  };

  return messages[reason];
}

/** Default low confidence message (backward compatible) */
export const LOW_CONFIDENCE_MESSAGE = {
  summary: "I don't see this covered in the current docs or code.",
  bullets: [
    {
      text: "If this is something you think Light should support, submit a Feature Request via Linear.",
      citations: [],
    },
    {
      text: "Hover over this message, click '…' → 'Create Issue in Linear', select Product Team, choose Feature Request template.",
      citations: [],
    },
  ],
  sources: [],
  confidence: "low" as const,
};

const LOW_CONFIDENCE_MESSAGE_DEFAULT = LOW_CONFIDENCE_MESSAGE;
