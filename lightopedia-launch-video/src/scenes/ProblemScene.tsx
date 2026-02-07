import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { LightLogo } from "../assets/LightLogo";

export const ProblemScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in
  const opacity = interpolate(frame, [0, 0.3 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Logo animation
  const logoScale = interpolate(
    frame,
    [0.3 * fps, 0.5 * fps, 0.6 * fps],
    [0, 1.1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const logoGlow = interpolate(
    frame,
    [0.3 * fps, 0.5 * fps, 0.9 * fps],
    [0, 1.5, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Text fade in
  const textOpacity = interpolate(
    frame,
    [1 * fps, 1.5 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const textY = interpolate(
    frame,
    [1 * fps, 1.5 * fps],
    [15, 0],
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
        {/* Logo */}
        <div
          style={{
            marginBottom: 50,
            transform: `scale(${logoScale})`,
          }}
        >
          <LightLogo
            width={300}
            height={92}
            glow
            glowIntensity={logoGlow}
            glowColor="#ffffff"
          />
        </div>

        {/* Simple tagline */}
        <div
          style={{
            opacity: textOpacity,
            transform: `translateY(${textY}px)`,
          }}
        >
          <p
            style={{
              fontSize: 36,
              color: "#666666",
              margin: 0,
              fontWeight: 400,
            }}
          >
            Your AI knowledge assistant
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};
