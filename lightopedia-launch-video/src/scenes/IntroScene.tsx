import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { LightLogo } from "../assets/LightLogo";

export const IntroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in - faster
  const opacity = interpolate(frame, [0, 0.15 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Logo animation - quick bounce in
  const logoScale = interpolate(
    frame,
    [0.05 * fps, 0.2 * fps, 0.3 * fps],
    [0, 1.1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Logo glow - brief flash
  const glowIntensity = interpolate(
    frame,
    [0.05 * fps, 0.2 * fps, 0.4 * fps],
    [0, 1.5, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Title fade in - faster
  const titleOpacity = interpolate(
    frame,
    [0.25 * fps, 0.45 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const titleY = interpolate(
    frame,
    [0.25 * fps, 0.45 * fps],
    [10, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Tagline fade in - right after title
  const taglineOpacity = interpolate(
    frame,
    [0.5 * fps, 0.7 * fps],
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
        {/* Logo */}
        <div
          style={{
            marginBottom: 40,
            transform: `scale(${logoScale})`,
          }}
        >
          <LightLogo width={280} height={86} glow glowIntensity={glowIntensity} />
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 56,
            color: "#ffffff",
            margin: 0,
            fontWeight: 600,
            transform: `translateY(${titleY}px)`,
            opacity: titleOpacity,
          }}
        >
          Introducing <span style={{ color: "#36c5f0" }}>Lightopedia</span>
        </h1>

        {/* Tagline */}
        <p
          style={{
            fontSize: 24,
            color: "#a0a0a0",
            margin: 0,
            marginTop: 16,
            opacity: taglineOpacity,
          }}
        >
          Your AI-powered knowledge assistant
        </p>
      </div>
    </AbsoluteFill>
  );
};
