import { CHUNK_SIZE, CHUNK_OVERLAP } from "./config.js";

export interface Chunk {
  content: string;
  index: number;
  metadata: {
    source: string;
    heading?: string;
  };
}

export function chunkDocument(content: string, source: string): Chunk[] {
  const chunks: Chunk[] = [];

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
          heading: section.heading,
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
    if (current.length + para.length > maxSize && current.length > 0) {
      chunks.push(current);
      // Start next chunk with overlap from end of current
      const overlapText = current.slice(-overlap);
      current = overlapText + "\n\n" + para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}
