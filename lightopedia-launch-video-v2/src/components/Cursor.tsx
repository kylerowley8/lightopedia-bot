import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

export const Cursor: React.FC<{ blinking: boolean }> = ({ blinking }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Blink every half second when blinking; otherwise always visible
  const blink = Math.floor(frame / (fps * 0.5)) % 2 === 0;
  const opacity = blinking ? (blink ? 1 : 0) : 1;

  return (
    <span
      className="w-4 h-10 bg-[#333] ml-0.5 inline-block align-middle"
      style={{ opacity }}
    />
  );
};
