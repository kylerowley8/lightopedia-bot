import { CHUNK_SIZE, CHUNK_OVERLAP } from "./config.js";

export interface Chunk {
  content: string;
  index: number;
  metadata: {
    source: string;
    sourceType: "article";
    heading?: string;
    title?: string;
    filePath?: string;
  };
}

/**
 * Source type is always "article" for help-articles.
 */
export function getSourceType(_source: string): "article" {
  return "article";
}

/**
 * Extract article title from markdown content.
 * Looks for the first # heading.
 */
export function extractArticleTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

/**
 * Extract clean file path from source (remove repo prefix).
 */
export function extractFilePath(source: string): string {
  const parts = source.split("/");
  if (parts.length > 2) {
    return parts.slice(2).join("/");
  }
  return source;
}

export function chunkDocument(content: string, source: string): Chunk[] {
  const chunks: Chunk[] = [];
  const filePath = extractFilePath(source);
  const title = extractArticleTitle(content);

  // Split by markdown headings first
  const sections = splitByHeadings(content);

  let chunkIndex = 0;
  for (const section of sections) {
    const sectionChunks = chunkSection(section.content, CHUNK_SIZE, CHUNK_OVERLAP);

    for (const text of sectionChunks) {
      chunks.push({
        content: text.trim(),
        index: chunkIndex++,
        metadata: {
          source,
          sourceType: "article",
          filePath,
          heading: section.heading,
          title,
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
    const paraParts = splitLongText(para, maxSize);

    for (const part of paraParts) {
      if (current.length + part.length > maxSize && current.length > 0) {
        chunks.push(current);
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

  // Final safety check
  const safeChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > maxSize * 1.5) {
      safeChunks.push(...splitLongText(chunk, maxSize));
    } else {
      safeChunks.push(chunk);
    }
  }

  return safeChunks;
}

function splitLongText(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];

  const parts: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxSize) {
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

function splitByNewlinesOrHard(text: string, maxSize: number): string[] {
  const parts: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (line.length > maxSize) {
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
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
