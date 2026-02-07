import { useVideoConfig, Audio, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { IntroScene } from "./scenes/IntroScene";
import { DemoScene } from "./scenes/DemoScene";
import { WhatItKnowsScene } from "./scenes/WhatItKnowsScene";
import { CTAScene } from "./scenes/CTAScene";

// Background music - place your audio file in /public/music.mp3
const MUSIC_FILE = "music.mp3";

export const LightopediaLaunch = () => {
  const { fps } = useVideoConfig();

  const transitionDuration = 10; // frames (~0.33s)

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: "#000000",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Background music - low volume, fades out at end */}
      <Audio
        src={staticFile(MUSIC_FILE)}
        volume={(f) =>
          // Fade in over first 0.5s, fade out over last 1s
          f < 0.5 * fps
            ? f / (0.5 * fps) * 0.3
            : f > (21 - 1) * fps
              ? ((21 * fps - f) / fps) * 0.3
              : 0.3
        }
      />

      <TransitionSeries>
        {/* Scene 1: Intro - Logo + "Introducing Lightopedia" (2.5 seconds) */}
        <TransitionSeries.Sequence durationInFrames={2.5 * fps}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: transitionDuration })}
        />

        {/* Scene 2: Demo - Q&A + Thread Follow-up (11 seconds) */}
        <TransitionSeries.Sequence durationInFrames={11 * fps}>
          <DemoScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: transitionDuration })}
        />

        {/* Scene 3: What It Knows - Sources (3 seconds) */}
        <TransitionSeries.Sequence durationInFrames={3 * fps}>
          <WhatItKnowsScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: transitionDuration })}
        />

        {/* Scene 4: Call to Action (3 seconds) */}
        <TransitionSeries.Sequence durationInFrames={3 * fps}>
          <CTAScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </div>
  );
};
