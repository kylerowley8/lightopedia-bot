import "./index.css";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { TerminalScene } from "./scenes/TerminalScene";
import { SlackDemoScene } from "./scenes/SlackDemoScene";
import { CTAScene } from "./scenes/CTAScene";

// Scene durations in seconds
const TERMINAL_DURATION = 8;
const SLACK_DEMO_DURATION = 5;
const CTA_DURATION = 2;

export const LightopediaLaunch: React.FC = () => {
  const { fps } = useVideoConfig();

  const terminalFrames = TERMINAL_DURATION * fps;
  const slackFrames = SLACK_DEMO_DURATION * fps;
  const ctaFrames = CTA_DURATION * fps;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      {/* Scene 1: Terminal Install */}
      <Sequence from={0} durationInFrames={terminalFrames}>
        <TerminalScene />
      </Sequence>

      {/* Scene 2: Slack Demo */}
      <Sequence from={terminalFrames} durationInFrames={slackFrames}>
        <SlackDemoScene />
      </Sequence>

      {/* Scene 3: CTA */}
      <Sequence from={terminalFrames + slackFrames} durationInFrames={ctaFrames}>
        <CTAScene />
      </Sequence>
    </AbsoluteFill>
  );
};
