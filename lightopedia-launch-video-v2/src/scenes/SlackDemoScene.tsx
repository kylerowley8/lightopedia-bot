import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { SlackWindow } from "../components/SlackWindow";
import { SlackMessage, TypingIndicator } from "../components/SlackMessage";
import { TypewriterText } from "../components/TypewriterText";

export const SlackDemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Timeline (5 seconds total):
  // 0-0.3s: Scene fades in
  // 0.3-0.6s: Question appears
  // 0.6-1.0s: Typing indicator
  // 1.0-4.0s: Answer types out
  // 4.0-5.0s: Hold

  const questionFrame = 0.3 * fps;
  const typingStart = 0.6 * fps;
  const typingEnd = 1.0 * fps;
  const answerStart = 1.0 * fps;

  const showTyping = frame >= typingStart && frame < typingEnd;

  const answer = `Yes! Multi-currency is fully supported.

**Quick setup:**
• Settings → Currencies → Add EUR
• Exchange rates sync automatically

Invoices will auto-convert for reporting.`;

  // Scene fade in
  const sceneOpacity = interpolate(frame, [0, 0.2 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Subtle scale animation
  const scale = interpolate(
    frame,
    [0, 0.3 * fps],
    [0.95, 1],
    { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        opacity: sceneOpacity,
        transform: `scale(${scale})`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0a0a0a",
      }}
    >
      <SlackWindow channelName="lightopedia">
        {/* Question */}
        <SlackMessage
          username="Sarah Chen"
          timestamp="2:34 PM"
          startFrame={questionFrame}
        >
          <span style={{ color: "#36c5f0" }}>@Lightopedia</span> Can we invoice in EUR?
        </SlackMessage>

        {showTyping && <TypingIndicator startFrame={typingStart} />}

        {frame >= answerStart && (
          <SlackMessage
            username="Lightopedia"
            isBot
            timestamp="2:34 PM"
            startFrame={answerStart}
          >
            <TypewriterText
              text={answer}
              startFrame={answerStart}
              charsPerFrame={3}
              style={{ whiteSpace: "pre-wrap" }}
            />
          </SlackMessage>
        )}
      </SlackWindow>
    </div>
  );
};
