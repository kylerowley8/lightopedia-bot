import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { SlackWindow } from "../components/SlackWindow";
import { SlackMessage, TypingIndicator, SourceCitation } from "../components/SlackMessage";
import { TypewriterText } from "../components/TypewriterText";

export const DemoScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Tighter timeline for 20 seconds:
  // 0-0.5s: Q1 appears
  // 0.5-1s: Typing (0.5s)
  // 1-4s: Answer 1 types (~200 chars at 2.5/frame = 2.7s)
  // 4-4.5s: Sources appear immediately after typing
  // 5-5.5s: Follow-up question
  // 5.5-6s: Typing (0.5s)
  // 6-10s: Follow-up answer types (~270 chars at 2.5/frame = 3.6s)
  // 10-20s: Hold for viewing

  // Question 1: Multi-currency
  const question1Frame = 0.5 * fps;
  const typing1Start = 1 * fps;
  const typing1End = 1.5 * fps;
  const answer1Start = 1.5 * fps;
  // answer1 is ~200 chars, finishes around 1.5s + 2.7s = 4.2s
  const sources1Frame = 4.5 * fps;  // Show sources right after typing

  // Follow-up question in thread
  const followUpFrame = 5.5 * fps;
  const typing2Start = 6 * fps;
  const typing2End = 6.5 * fps;
  const answer2Start = 6.5 * fps;

  const showTyping1 = frame >= typing1Start && frame < typing1End;
  const showTyping2 = frame >= typing2Start && frame < typing2End;

  const answer1 = `Yes! Light fully supports multi-currency.

**Quick setup:**
• Set base currency in Settings → Company
• Add currencies in Settings → Currencies
• Exchange rates sync automatically

You can create invoices in any configured currency.`;

  const answer2 = `For EUR specifically:

**Configuration:**
• Add EUR in Settings → Currencies
• Set EUR exchange rate (or enable auto-sync)
• Select EUR when creating invoices for EU customers

**In reports:**
Revenue auto-converts to your base currency for consistent reporting.`;

  // Scroll as follow-up appears
  const scrollY = interpolate(
    frame,
    [followUpFrame, answer2Start + 1.5 * fps],
    [0, 180],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <SlackWindow channelName="lightopedia" scrollY={scrollY}>
      {/* Question 1: Multi-currency */}
      <SlackMessage
        username="Sarah Chen"
        timestamp="2:34 PM"
        startFrame={question1Frame}
      >
        <span style={{ color: "#36c5f0" }}>@Lightopedia</span> Can Light handle multi-currency?
      </SlackMessage>

      {showTyping1 && <TypingIndicator startFrame={typing1Start} />}

      {frame >= answer1Start && (
        <SlackMessage
          username="Lightopedia"
          isBot
          timestamp="2:34 PM"
          startFrame={answer1Start}
        >
          <TypewriterText
            text={answer1}
            startFrame={answer1Start}
            charsPerFrame={2.5}
            style={{ whiteSpace: "pre-wrap" }}
          />
          {frame >= sources1Frame && (
            <SourceCitation
              sources={["Multi-Currency Guide", "Settings Docs"]}
              startFrame={sources1Frame}
            />
          )}
        </SlackMessage>
      )}

      {/* Thread indicator */}
      {frame >= followUpFrame && (
        <ThreadReplyIndicator startFrame={followUpFrame} />
      )}

      {/* Follow-up question in thread */}
      {frame >= followUpFrame && (
        <SlackMessage
          username="Sarah Chen"
          timestamp="2:35 PM"
          startFrame={followUpFrame}
          isThreadReply
        >
          What about for EUR specifically? Our European customers want to pay in euros.
        </SlackMessage>
      )}

      {showTyping2 && <TypingIndicator startFrame={typing2Start} />}

      {frame >= answer2Start && (
        <SlackMessage
          username="Lightopedia"
          isBot
          timestamp="2:35 PM"
          startFrame={answer2Start}
          isThreadReply
        >
          <TypewriterText
            text={answer2}
            startFrame={answer2Start}
            charsPerFrame={2.5}
            style={{ whiteSpace: "pre-wrap" }}
          />
        </SlackMessage>
      )}
    </SlackWindow>
  );
};

// Thread reply indicator
const ThreadReplyIndicator = ({ startFrame }: { startFrame: number }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 8],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginLeft: 52,
        marginTop: -8,
        marginBottom: 8,
        opacity,
      }}
    >
      <div
        style={{
          width: 2,
          height: 20,
          backgroundColor: "#36c5f0",
          borderRadius: 1,
        }}
      />
      <span style={{ color: "#36c5f0", fontSize: 13 }}>
        Thread
      </span>
    </div>
  );
};
