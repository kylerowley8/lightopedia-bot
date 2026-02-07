import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { LightLogo } from "../assets/LightLogo";

export const CTAScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in
  const opacity = interpolate(frame, [0, 0.3 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Logo bounce
  const logoScale = interpolate(
    frame,
    [0.2 * fps, 0.4 * fps, 0.5 * fps],
    [0, 1.1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Logo glow - brief flash
  const glowIntensity = interpolate(
    frame,
    [0.2 * fps, 0.4 * fps, 0.8 * fps],
    [0, 1.2, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Channel name fade in
  const channelOpacity = interpolate(
    frame,
    [0.6 * fps, 1 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center" }}>
        {/* Light logo */}
        <div
          style={{
            marginBottom: 50,
            transform: `scale(${logoScale})`,
          }}
        >
          <LightLogo width={250} height={77} glow glowIntensity={glowIntensity} />
        </div>

        {/* Channel name */}
        <div
          style={{
            opacity: channelOpacity,
          }}
        >
          <p
            style={{
              fontSize: 32,
              color: "#666666",
              margin: 0,
              marginBottom: 20,
            }}
          >
            Try it in
          </p>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 24px",
              backgroundColor: "#1a1a1a",
              borderRadius: 8,
              border: "1px solid #333333",
            }}
          >
            <span style={{ color: "#666666", fontSize: 36 }}>#</span>
            <span
              style={{
                color: "#ffffff",
                fontSize: 36,
                fontWeight: 600,
              }}
            >
              lightopedia
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
