import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXPANSION_PROMPT = `You are a search query optimizer for a knowledge base about Light, a finance/billing platform.

Given a user question, generate 3 short keyword-based search queries (NOT full questions). Each query should:
- Be 2-5 keywords only, no question words (how, what, why, etc.)
- Use different terminology to maximize matches
- Focus on the core concepts

IMPORTANT - Light uses specific terminology. Always include synonyms:
- "contracts" → also use "bills", "invoices", "supplier invoices"
- "OCR" → also use "document scanning", "ingestion", "extraction"
- "vendors" → also use "suppliers"
- "payments" → also use "payment runs", "AP", "accounts payable"
- "customers" → also use "accounts", "AR", "accounts receivable"

Example:
Question: "How does Light handle contract scanning?"
Good output:
bills OCR extraction
supplier invoice ingestion
document scanning Light

Respond with exactly 3 keyword queries, one per line, no numbering or bullets.`;

export async function expandQuery(question: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EXPANSION_PROMPT },
        { role: "user", content: question },
      ],
      temperature: 0.5,
      max_tokens: 150,
    });

    const content = response.choices[0]?.message?.content || "";
    const variations = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 3);

    // Always include the original question
    return [question, ...variations];
  } catch (err) {
    console.error("Query expansion failed, using original:", err);
    return [question];
  }
}
