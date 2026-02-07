import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { LightLogo } from "../assets/LightLogo";

export const SolutionScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in
  const opacity = interpolate(frame, [0, 0.3 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Logo animation
  const logoScale = interpolate(
    frame,
    [0.2 * fps, 0.4 * fps, 0.5 * fps],
    [0, 1.1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Logo glow - brief flash on appear only
  const glowIntensity = interpolate(
    frame,
    [0.2 * fps, 0.4 * fps, 0.8 * fps],
    [0, 1.5, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Title fade in
  const titleOpacity = interpolate(
    frame,
    [0.6 * fps, 1 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const titleY = interpolate(
    frame,
    [0.6 * fps, 1 * fps],
    [20, 0],
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
      </div>
    </AbsoluteFill>
  );
};
