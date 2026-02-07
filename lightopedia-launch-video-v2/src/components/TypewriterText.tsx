import { useCurrentFrame, interpolate } from "remotion";
import React from "react";

interface TypewriterTextProps {
  text: string;
  startFrame: number;
  style?: React.CSSProperties;
  charsPerFrame?: number;
}

// Parse simple markdown (bold with **text**)
const parseMarkdown = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add bold text
    parts.push(
      <strong key={match.index} style={{ fontWeight: 700, color: "#ffffff" }}>
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
};

export const TypewriterText = ({
  text,
  startFrame,
  style = {},
  charsPerFrame = 0.8,
}: TypewriterTextProps) => {
  const frame = useCurrentFrame();

  const charsToShow = Math.floor(
    Math.max(0, (frame - startFrame) * charsPerFrame)
  );

  const displayText = text.slice(0, charsToShow);

  // Blinking cursor
  const cursorOpacity = interpolate(
    frame % 30,
    [0, 15, 16, 30],
    [1, 1, 0, 0]
  );

  const showCursor = charsToShow < text.length;

  return (
    <span style={style}>
      {parseMarkdown(displayText)}
      {showCursor && (
        <span
          style={{
            opacity: cursorOpacity,
            borderRight: "2px solid currentColor",
            marginLeft: 2,
          }}
        />
      )}
    </span>
  );
};
