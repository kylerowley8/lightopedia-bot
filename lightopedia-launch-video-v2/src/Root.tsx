import "./index.css";
import { Composition, Folder } from "remotion";
import { LightopediaLaunch } from "./LightopediaLaunch";
import { TerminalScene } from "./scenes/TerminalScene";
import { SlackDemoScene } from "./scenes/SlackDemoScene";
import { CTAScene } from "./scenes/CTAScene";

const FPS = 30;

// Scene durations
const TERMINAL_DURATION = 8;
const SLACK_DEMO_DURATION = 5;
const CTA_DURATION = 2;
const TOTAL_DURATION = TERMINAL_DURATION + SLACK_DEMO_DURATION + CTA_DURATION; // 15s

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main composition */}
      <Composition
        id="LightopediaLaunch"
        component={LightopediaLaunch}
        durationInFrames={TOTAL_DURATION * FPS}
        fps={FPS}
        width={1080}
        height={700}
      />

      {/* Individual scenes for preview */}
      <Folder name="Scenes">
        <Composition
          id="TerminalScene"
          component={TerminalScene}
          durationInFrames={TERMINAL_DURATION * FPS}
          fps={FPS}
          width={1080}
          height={700}
        />
        <Composition
          id="SlackDemoScene"
          component={SlackDemoScene}
          durationInFrames={SLACK_DEMO_DURATION * FPS}
          fps={FPS}
          width={1080}
          height={700}
        />
        <Composition
          id="CTAScene"
          component={CTAScene}
          durationInFrames={CTA_DURATION * FPS}
          fps={FPS}
          width={1080}
          height={700}
        />
      </Folder>
    </>
  );
};
