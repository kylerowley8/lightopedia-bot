import { useCurrentFrame, interpolate } from "remotion";
import React from "react";
import { LightBolt } from "../assets/LightBolt";
import { Avatar } from "./Avatar";

interface SlackMessageProps {
  avatar?: string;
  username: string;
  isBot?: boolean;
  timestamp?: string;
  children: React.ReactNode;
  startFrame: number;
  animationType?: "fade" | "slide" | "none";
  isThreadReply?: boolean;
}

export const SlackMessage = ({
  avatar,
  username,
  isBot = false,
  timestamp = "now",
  children,
  startFrame,
  animationType = "slide",
  isThreadReply = false,
}: SlackMessageProps) => {
  const frame = useCurrentFrame();

  const opacity =
    animationType === "none"
      ? 1
      : interpolate(frame, [startFrame, startFrame + 6], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const translateY =
    animationType === "slide"
      ? interpolate(frame, [startFrame, startFrame + 6], [10, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

  // Pulse effect for bot messages on initial appearance
  const botPulseGlow = isBot
    ? interpolate(
        frame,
        [startFrame, startFrame + 8, startFrame + 20],
        [0, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : 0;

  const botScale = isBot
    ? interpolate(
        frame,
        [startFrame, startFrame + 5, startFrame + 10],
        [0.8, 1.1, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : 1;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        opacity,
        transform: `translateY(${translateY}px)`,
        marginLeft: isThreadReply ? 20 : 0,
        paddingLeft: isThreadReply ? 12 : 0,
        borderLeft: isThreadReply ? "2px solid #36c5f0" : "none",
      }}
    >
      {/* Avatar */}
      {isBot ? (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 6,
            backgroundColor: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transform: `scale(${botScale})`,
            boxShadow: botPulseGlow > 0
              ? `0 0 ${20 * botPulseGlow}px rgba(54, 197, 240, ${0.6 * botPulseGlow})`
              : "none",
          }}
        >
          <LightBolt size={28} fill="#000000" />
        </div>
      ) : (
        <Avatar name={username} size={40} />
      )}

      {/* Message content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Username and timestamp */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {username}
          </span>
          {isBot && (
            <span
              style={{
                backgroundColor: "#4a154b",
                color: "#ffffff",
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                fontWeight: 600,
              }}
            >
              APP
            </span>
          )}
          <span
            style={{
              color: "#616061",
              fontSize: 12,
            }}
          >
            {timestamp}
          </span>
        </div>

        {/* Message body */}
        <div
          style={{
            color: "#d1d2d3",
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

// Typing indicator component
export const TypingIndicator = ({ startFrame }: { startFrame: number }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [startFrame, startFrame + 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const dotDelay = 8;
  const dot1 = interpolate((frame - startFrame) % 24, [0, 12], [0.4, 1]);
  const dot2 = interpolate(((frame - startFrame) + dotDelay) % 24, [0, 12], [0.4, 1]);
  const dot3 = interpolate(((frame - startFrame) + dotDelay * 2) % 24, [0, 12], [0.4, 1]);

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        opacity,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 6,
          backgroundColor: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <LightBolt size={28} fill="#000000" />
      </div>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "12px 16px",
          backgroundColor: "#2d2d2d",
          borderRadius: 8,
        }}
      >
        <Dot opacity={dot1} />
        <Dot opacity={dot2} />
        <Dot opacity={dot3} />
      </div>
    </div>
  );
};

const Dot = ({ opacity }: { opacity: number }) => (
  <div
    style={{
      width: 8,
      height: 8,
      borderRadius: "50%",
      backgroundColor: "#b9bbbe",
      opacity,
    }}
  />
);

// Answer complete checkmark
export const AnswerComplete = ({
  startFrame,
}: {
  startFrame: number;
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 12],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const scale = interpolate(
    frame,
    [startFrame, startFrame + 8, startFrame + 12],
    [0.5, 1.15, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginTop: 10,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          backgroundColor: "#27c93f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 10px rgba(39, 201, 63, 0.4)",
        }}
      >
        <span style={{ color: "#ffffff", fontSize: 12, fontWeight: 700 }}>✓</span>
      </div>
      <span style={{ color: "#27c93f", fontSize: 12, fontWeight: 500 }}>
        Answer complete
      </span>
    </div>
  );
};

// Emoji reactions component
export const EmojiReactions = ({
  reactions,
  startFrame,
}: {
  reactions: { emoji: string; count: number }[];
  startFrame: number;
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        marginTop: 8,
      }}
    >
      {reactions.map((reaction, i) => {
        const reactionDelay = i * 8;
        const opacity = interpolate(
          frame,
          [startFrame + reactionDelay, startFrame + reactionDelay + 10],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        const scale = interpolate(
          frame,
          [startFrame + reactionDelay, startFrame + reactionDelay + 6, startFrame + reactionDelay + 10],
          [0.5, 1.2, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              backgroundColor: "#2d2d2d",
              borderRadius: 12,
              border: "1px solid #383838",
              opacity,
              transform: `scale(${scale})`,
            }}
          >
            <span style={{ fontSize: 14 }}>{reaction.emoji}</span>
            <span style={{ fontSize: 12, color: "#b9bbbe" }}>{reaction.count}</span>
          </div>
        );
      })}
    </div>
  );
};

// Source citation component
export const SourceCitation = ({
  sources,
  startFrame,
}: {
  sources: string[];
  startFrame: number;
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [startFrame, startFrame + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid #383838",
        opacity,
      }}
    >
      <div
        style={{
          color: "#616061",
          fontSize: 12,
          marginBottom: 6,
        }}
      >
        Sources:
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sources.map((source, i) => (
          <span
            key={i}
            style={{
              backgroundColor: "#2d2d2d",
              color: "#36c5f0",
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 4,
            }}
          >
            {source}
          </span>
        ))}
      </div>
    </div>
  );
};
