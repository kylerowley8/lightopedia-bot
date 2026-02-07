import { AbsoluteFill } from "remotion";
import { TerminalContent } from "./TerminalContent";

export const MacTerminal: React.FC = () => {
  return (
    <AbsoluteFill className="p-10">
      <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden shadow-2xl">
        {/* Title bar */}
        <div className="h-16 bg-[#f6f6f6] flex items-center px-6 border-b border-[#e0e0e0]">
          <div className="flex gap-3">
            <div className="w-4.5 h-4.5 rounded-full bg-[#ff5f57]" />
            <div className="w-4.5 h-4.5 rounded-full bg-[#febc2e]" />
            <div className="w-4.5 h-4.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[#4d4d4d] text-lg font-medium">Terminal</span>
          </div>
          <div className="w-16" />
        </div>

        <TerminalContent />
      </div>
    </AbsoluteFill>
  );
};
