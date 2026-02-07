import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

export const WhatItKnowsScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in
  const opacity = interpolate(frame, [0, 0.2 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Faster staggered icon appearances
  const sources = [
    { icon: "📄", label: "Documentation", delay: 0.2 * fps },
    { icon: "💻", label: "Codebase", delay: 0.6 * fps },
    { icon: "💬", label: "Slack threads", delay: 1 * fps },
  ];

  // Tagline fade in - right after icons
  const taglineOpacity = interpolate(
    frame,
    [1.4 * fps, 1.8 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#222222",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center" }}>
        {/* Title */}
        <h2
          style={{
            fontSize: 48,
            color: "#ffffff",
            margin: 0,
            marginBottom: 60,
            fontWeight: 600,
          }}
        >
          Grounded in real sources
        </h2>

        {/* Source icons */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 80,
            marginBottom: 60,
          }}
        >
          {sources.map((source, i) => (
            <SourceIcon
              key={i}
              icon={source.icon}
              label={source.label}
              startFrame={source.delay}
            />
          ))}
        </div>

        {/* Tagline */}
        <p
          style={{
            fontSize: 28,
            color: "#a0a0a0",
            opacity: taglineOpacity,
            margin: 0,
          }}
        >
          Every answer is citation-backed — no hallucinations
        </p>
      </div>
    </AbsoluteFill>
  );
};

const SourceIcon = ({
  icon,
  label,
  startFrame,
}: {
  icon: string;
  label: string;
  startFrame: number;
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const scale = interpolate(
    frame,
    [startFrame, startFrame + 6, startFrame + 10],
    [0.5, 1.15, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const translateY = interpolate(
    frame,
    [startFrame, startFrame + 10],
    [20, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        opacity,
        transform: `scale(${scale}) translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          width: 100,
          height: 100,
          borderRadius: 20,
          backgroundColor: "#2d2d2d",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
          border: "2px solid #383838",
        }}
      >
        {icon}
      </div>
      <span
        style={{
          color: "#ffffff",
          fontSize: 20,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
    </div>
  );
};
