import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import React from "react";

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  delay: number;
}

// Generate deterministic particles based on seed
const generateParticles = (count: number, seed: number): Particle[] => {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const rand = (n: number) => ((seed * (i + 1) * n) % 1000) / 1000;
    particles.push({
      x: rand(1) * 100,
      y: rand(2) * 100,
      size: 2 + rand(3) * 4,
      speed: 0.3 + rand(4) * 0.7,
      opacity: 0.1 + rand(5) * 0.2,
      delay: rand(6) * 100,
    });
  }
  return particles;
};

interface BackgroundParticlesProps {
  count?: number;
  color?: string;
  seed?: number;
}

export const BackgroundParticles = ({
  count = 30,
  color = "#ffffff",
  seed = 42,
}: BackgroundParticlesProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const particles = React.useMemo(() => generateParticles(count, seed), [count, seed]);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {particles.map((particle, i) => {
        const yOffset = ((frame + particle.delay) * particle.speed * 0.5) % 120;
        const floatY = Math.sin((frame + particle.delay) * 0.05) * 10;

        const opacity = interpolate(
          frame,
          [0, 30],
          [0, particle.opacity],
          { extrapolateRight: "clamp" }
        );

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${particle.x}%`,
              top: `${particle.y - yOffset + floatY}%`,
              width: particle.size,
              height: particle.size,
              borderRadius: "50%",
              backgroundColor: color,
              opacity,
            }}
          />
        );
      })}
    </div>
  );
};

interface BackgroundGradientProps {
  color1?: string;
  color2?: string;
  angle?: number;
}

export const BackgroundGradient = ({
  color1 = "#222222",
  color2 = "#1a1a2e",
  angle = 135,
}: BackgroundGradientProps) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: `linear-gradient(${angle}deg, ${color1} 0%, ${color2} 100%)`,
      }}
    />
  );
};
