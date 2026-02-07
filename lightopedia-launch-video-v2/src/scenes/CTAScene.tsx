import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

export const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Channel chip animation
  const chipScale = spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.5, stiffness: 200 },
  });

  const chipOpacity = interpolate(frame, [0, 0.2 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Glow pulse
  const glowIntensity = interpolate(
    frame,
    [0.3 * fps, 0.6 * fps, 1 * fps],
    [0, 1, 0.5],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0a0a",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          opacity: chipOpacity,
          transform: `scale(${chipScale})`,
        }}
      >
        {/* Channel chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 32px",
            backgroundColor: "#1a1d21",
            borderRadius: 12,
            border: "1px solid #383838",
            boxShadow: `0 0 ${40 * glowIntensity}px rgba(54, 197, 240, ${0.3 * glowIntensity})`,
          }}
        >
          <span style={{ color: "#36c5f0", fontSize: 48, fontWeight: 500 }}>#</span>
          <span
            style={{
              color: "#ffffff",
              fontSize: 48,
              fontWeight: 600,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}
          >
            lightopedia
          </span>
        </div>

        {/* Tagline */}
        <p
          style={{
            color: "#666666",
            fontSize: 24,
            margin: 0,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          Your AI knowledge assistant
        </p>
      </div>
    </AbsoluteFill>
  );
};
