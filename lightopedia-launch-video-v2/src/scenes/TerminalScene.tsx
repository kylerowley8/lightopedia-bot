import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MacTerminal } from "../components/MacTerminal";

export const TerminalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const slideIn = spring({
    frame,
    fps,
    config: { damping: 200, mass: 1, stiffness: 200 },
  });

  const translateY = interpolate(slideIn, [0, 1], [700, 100]);

  const rotateY = interpolate(frame, [0, durationInFrames], [10, -10]);
  const scale = interpolate(frame, [0, durationInFrames], [0.98, 1.02]);

  return (
    <AbsoluteFill className="bg-[#f8fafc]" style={{ perspective: 1000 }}>
      <Sequence
        from={0}
        durationInFrames={durationInFrames}
        style={{
          transformOrigin: "50% 100%",
          transform: `translateY(${translateY}px) rotateX(18deg) rotateY(${rotateY}deg) scale(${scale})`,
        }}
      >
        <MacTerminal />
      </Sequence>
    </AbsoluteFill>
  );
};
