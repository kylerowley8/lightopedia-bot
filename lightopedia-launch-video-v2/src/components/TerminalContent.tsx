import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { Cursor } from "./Cursor";

const LIGHTOPEDIA_LOGO = `██╗     ██╗ ██████╗ ██╗  ██╗████████╗ ██████╗ ██████╗ ███████╗██████╗ ██╗ █████╗
██║     ██║██╔════╝ ██║  ██║╚══██╔══╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗██║██╔══██╗
██║     ██║██║  ███╗███████║   ██║   ██║   ██║██████╔╝█████╗  ██║  ██║██║███████║
██║     ██║██║   ██║██╔══██║   ██║   ██║   ██║██╔═══╝ ██╔══╝  ██║  ██║██║██╔══██║
███████╗██║╚██████╔╝██║  ██║   ██║   ╚██████╔╝██║     ███████╗██████╔╝██║██║  ██║
╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚══════╝╚═════╝ ╚═╝╚═╝  ╚═╝`;

const OUTPUT_LINES = [
  "┌ lightopedia",
  "│",
  "◇ Connecting to Light workspace...",
  "│",
  "◇ Indexing knowledge sources",
  "│",
  "●  Documentation     ████████████████ 142 pages",
  "●  Codebase          ████████████████ 847 files",
  "●  Slack threads     ████████████████ 2.3k messages",
  "│",
  "◇ Building embeddings...",
  "│",
  "◇ Bot registered: @Lightopedia",
  "│",
  "└ Ready in #lightopedia",
];

export const TerminalContent: React.FC<{
  command?: string;
  charsPerSecond?: number;
}> = ({
  command = "npx lightopedia init --workspace light",
  charsPerSecond = 18,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const framesPerChar = fps / charsPerSecond;
  const visibleChars = Math.max(0, Math.floor(frame / framesPerChar));
  const displayedText = command.slice(0, visibleChars);
  const isTyping = visibleChars < command.length;

  const outputStartFrame = Math.ceil(command.length * framesPerChar) + fps * 0.4;

  // Output reveal: fast line-by-line stream
  const framesPerLine = fps * 0.06; // ~60ms per line
  const logoFrame = outputStartFrame;
  const linesStartFrame = logoFrame + fps * 0.3;

  const visibleLines = Math.floor(
    interpolate(frame, [linesStartFrame, linesStartFrame + framesPerLine * OUTPUT_LINES.length], [0, OUTPUT_LINES.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  return (
    <div className="flex-1 bg-white p-8 font-mono text-5xl">
      <div className="flex items-center text-[#333] leading-none">
        <span className="text-[#2ecc71] font-semibold">~</span>
        <span className="mx-3">$</span>
        <span>{displayedText}</span>
        <Cursor blinking={!isTyping} />
      </div>

      {/* Output */}
      <div className="mt-6 text-2xl leading-tight text-[#2b2b2b]">
        {frame >= logoFrame ? (
          <pre className="m-0 whitespace-pre-wrap">{LIGHTOPEDIA_LOGO}</pre>
        ) : null}
        <div className="mt-4">
          {OUTPUT_LINES.slice(0, Math.max(0, visibleLines)).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
};
