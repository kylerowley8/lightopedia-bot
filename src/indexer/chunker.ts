import { CHUNK_SIZE, CHUNK_OVERLAP } from "./config.js";

export type SourceType = "code" | "docs" | "notion" | "unknown";

export interface Chunk {
  content: string;
  index: number;
  metadata: {
    source: string;
    sourceType: SourceType;
    heading?: string;
    symbols?: string[];      // For code: class/function/object names
    filePath?: string;       // Clean file path without repo prefix
  };
}

/**
 * Determine source type based on file path/source
 */
export function getSourceType(source: string): SourceType {
  // Notion sources
  if (source.startsWith("notion-") || source.includes("/notion/")) {
    return "notion";
  }

  // Code files
  const codeExtensions = /\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|rb|swift|scala)$/i;
  if (codeExtensions.test(source)) {
    return "code";
  }

  // Documentation
  const docExtensions = /\.(md|mdx|txt|rst|adoc)$/i;
  if (docExtensions.test(source)) {
    return "docs";
  }

  // Config files (treat as code)
  const configExtensions = /\.(json|yaml|yml|toml|xml|gradle|properties)$/i;
  if (configExtensions.test(source)) {
    return "code";
  }

  return "unknown";
}

/**
 * Extract symbols from Kotlin code (class, object, interface, function names)
 */
export function extractKotlinSymbols(content: string): string[] {
  const symbols: string[] = [];

  // Match class/object/interface declarations
  const classPattern = /(?:class|object|interface|enum\s+class)\s+(\w+)/g;
  let match;
  while ((match = classPattern.exec(content)) !== null) {
    if (match[1]) symbols.push(match[1]);
  }

  // Match function declarations
  const funPattern = /fun\s+(?:<[^>]+>\s+)?(\w+)\s*\(/g;
  while ((match = funPattern.exec(content)) !== null) {
    if (match[1]) symbols.push(match[1]);
  }

  // Match top-level val/var declarations
  const valPattern = /^(?:val|var)\s+(\w+)\s*[=:]/gm;
  while ((match = valPattern.exec(content)) !== null) {
    if (match[1]) symbols.push(match[1]);
  }

  return [...new Set(symbols)]; // Deduplicate
}

/**
 * Extract symbols from TypeScript/JavaScript code
 */
export function extractTsSymbols(content: string): string[] {
  const symbols: string[] = [];

  // Match class/interface declarations
  const classPattern = /(?:class|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = classPattern.exec(content)) !== null) {
    if (match[1]) symbols.push(match[1]);
  }

  // Match function declarations
  const funPattern = /(?:function|async\s+function)\s+(\w+)\s*\(/g;
  while ((match = funPattern.exec(content)) !== null) {
    if (match[1]) symbols.push(match[1]);
  }

  // Match exported const/let declarations
  const constPattern = /export\s+(?:const|let|var)\s+(\w+)\s*[=:]/g;
  while ((match = constPattern.exec(content)) !== null) {
    if (match[1]) symbols.push(match[1]);
  }

  return [...new Set(symbols)];
}

/**
 * Extract symbols based on file type
 */
export function extractSymbols(content: string, source: string): string[] {
  if (/\.(kt|kts)$/i.test(source)) {
    return extractKotlinSymbols(content);
  }
  if (/\.(ts|tsx|js|jsx)$/i.test(source)) {
    return extractTsSymbols(content);
  }
  return [];
}

/**
 * Extract clean file path from source (remove repo prefix)
 */
export function extractFilePath(source: string): string {
  // source is like "light-space/light/path/to/file.kt"
  // We want "path/to/file.kt"
  const parts = source.split("/");
  if (parts.length > 2) {
    return parts.slice(2).join("/");
  }
  return source;
}

export function chunkDocument(content: string, source: string): Chunk[] {
  const chunks: Chunk[] = [];
  const sourceType = getSourceType(source);
  const filePath = extractFilePath(source);

  // Extract symbols from the full document for code files
  const documentSymbols = sourceType === "code" ? extractSymbols(content, source) : [];

  // Split by markdown headings first
  const sections = splitByHeadings(content);

  let chunkIndex = 0;
  for (const section of sections) {
    const sectionChunks = chunkSection(section.content, CHUNK_SIZE, CHUNK_OVERLAP);

    for (const text of sectionChunks) {
      // Extract symbols specific to this chunk for code files
      const chunkSymbols = sourceType === "code" ? extractSymbols(text, source) : [];

      chunks.push({
        content: text.trim(),
        index: chunkIndex++,
        metadata: {
          source,
          sourceType,
          filePath,
          heading: section.heading,
          // Include chunk-specific symbols, fall back to document symbols for context
          symbols: chunkSymbols.length > 0 ? chunkSymbols : documentSymbols.slice(0, 5),
        },
      });
    }
  }

  return chunks.filter((c) => c.content.length > 20); // Skip tiny chunks
}

interface Section {
  heading?: string;
  content: string;
}

function splitByHeadings(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | undefined;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join("\n"),
        });
      }
      currentHeading = headingMatch[1];
      currentContent = [line];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join("\n"),
    });
  }

  return sections;
}

function chunkSection(text: string, maxSize: number, overlap: number): string[] {
  if (text.length <= maxSize) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    // If paragraph itself is too long, split it further
    const paraParts = splitLongText(para, maxSize);

    for (const part of paraParts) {
      if (current.length + part.length > maxSize && current.length > 0) {
        chunks.push(current);
        // Start next chunk with overlap from end of current
        const overlapText = current.slice(-overlap);
        current = overlapText + "\n\n" + part;
      } else {
        current = current ? current + "\n\n" + part : part;
      }
    }
  }

  if (current.trim()) {
    chunks.push(current);
  }

  // Final safety check: split any chunks that are still too large
  const safeChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > maxSize * 1.5) {
      // Allow some flexibility but catch very large chunks
      safeChunks.push(...splitLongText(chunk, maxSize));
    } else {
      safeChunks.push(chunk);
    }
  }

  return safeChunks;
}

/**
 * Split text that's too long by sentence boundaries or hard character limits.
 */
function splitLongText(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];

  const parts: string[] = [];

  // First try to split by sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxSize) {
      // Sentence is too long, push current and split sentence by newlines or hard limit
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      parts.push(...splitByNewlinesOrHard(sentence, maxSize));
    } else if (current.length + sentence.length > maxSize) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.length > 0 ? parts : [text.slice(0, maxSize)];
}

/**
 * Split by newlines first, then by hard character limit as last resort.
 */
function splitByNewlinesOrHard(text: string, maxSize: number): string[] {
  const parts: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (line.length > maxSize) {
      // Line is too long, hard split it
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      // Hard split by character limit
      for (let i = 0; i < line.length; i += maxSize) {
        parts.push(line.slice(i, i + maxSize));
      }
    } else if (current.length + line.length + 1 > maxSize) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}
