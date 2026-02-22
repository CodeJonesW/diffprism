import { BriefingBar } from "./BriefingBar";
import { ReasoningPanel } from "./ReasoningPanel";
import { FileBrowser } from "./FileBrowser";
import { DiffViewer } from "./DiffViewer";
import { ActionBar } from "./ActionBar";
import type { ReviewResult } from "../types";

interface ReviewViewProps {
  onSubmit: (result: ReviewResult) => void;
  isWatchMode?: boolean;
  watchSubmitted?: boolean;
  hasUnreviewedChanges?: boolean;
}

export function ReviewView({ onSubmit, isWatchMode, watchSubmitted, hasUnreviewedChanges }: ReviewViewProps) {
  return (
    <div className="h-screen flex flex-col bg-background">
      <BriefingBar />
      <ReasoningPanel />
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — File Browser */}
        <div className="w-[280px] flex-shrink-0">
          <FileBrowser />
        </div>

        {/* Main area — Diff Viewer */}
        <DiffViewer />
      </div>

      {/* Bottom — Action Bar */}
      <ActionBar
        onSubmit={onSubmit}
        isWatchMode={isWatchMode}
        watchSubmitted={watchSubmitted}
        hasUnreviewedChanges={hasUnreviewedChanges}
      />
    </div>
  );
}
