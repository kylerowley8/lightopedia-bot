import { Composition, Folder } from "remotion";
import { LightopediaLaunch } from "./LightopediaLaunch";
import { IntroScene } from "./scenes/IntroScene";
import { DemoScene } from "./scenes/DemoScene";
import { WhatItKnowsScene } from "./scenes/WhatItKnowsScene";
import { CTAScene } from "./scenes/CTAScene";

// Video duration: 2.5s intro + 11s demo + 3s sources + 3s CTA + ~1s transitions ≈ 21s
const TOTAL_DURATION_SECONDS = 21;
const FPS = 30;

export const RemotionRoot = () => {
  return (
    <>
      {/* Main launch video */}
      <Composition
        id="LightopediaLaunch"
        component={LightopediaLaunch}
        durationInFrames={TOTAL_DURATION_SECONDS * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      {/* Individual scenes for preview/testing */}
      <Folder name="Scenes">
        <Composition
          id="IntroScene"
          component={IntroScene}
          durationInFrames={2.5 * FPS}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{}}
        />
        <Composition
          id="DemoScene"
          component={DemoScene}
          durationInFrames={11 * FPS}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{}}
        />
        <Composition
          id="WhatItKnowsScene"
          component={WhatItKnowsScene}
          durationInFrames={3 * FPS}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{}}
        />
        <Composition
          id="CTAScene"
          component={CTAScene}
          durationInFrames={3 * FPS}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{}}
        />
      </Folder>
    </>
  );
};
