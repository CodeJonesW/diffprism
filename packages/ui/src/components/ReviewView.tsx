import { BriefingBar } from "./BriefingBar";
import { ReasoningPanel } from "./ReasoningPanel";
import { FileBrowser } from "./FileBrowser";
import { DiffViewer } from "./DiffViewer";
import { ActionBar } from "./ActionBar";
import { HotkeyGuide } from "./HotkeyGuide";
import { AnnotationPanel } from "./AnnotationPanel";
import { useReviewStore } from "../store/review";
import type { ReviewResult } from "../types";

interface ReviewViewProps {
  onSubmit: (result: ReviewResult) => void;
  onDismiss?: () => void;
  isWatchMode?: boolean;
  watchSubmitted?: boolean;
  hasUnreviewedChanges?: boolean;
}

export function ReviewView({ onSubmit, onDismiss, isWatchMode, watchSubmitted, hasUnreviewedChanges }: ReviewViewProps) {
  const { annotations, dismissAnnotation, selectFile } = useReviewStore();

  return (
    <div className="h-screen flex flex-col bg-background">
      <BriefingBar />
      <ReasoningPanel />
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — File Browser + Annotations */}
        <div className="w-[280px] flex-shrink-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <FileBrowser onSubmit={onSubmit} />
          </div>
          <AnnotationPanel
            annotations={annotations}
            onDismiss={dismissAnnotation}
            onNavigate={selectFile}
          />
        </div>

        {/* Main area — Diff Viewer */}
        <DiffViewer />
      </div>

      {/* Bottom — Action Bar */}
      <ActionBar
        onSubmit={onSubmit}
        onDismiss={onDismiss}
        isWatchMode={isWatchMode}
        watchSubmitted={watchSubmitted}
        hasUnreviewedChanges={hasUnreviewedChanges}
      />
      <HotkeyGuide />
    </div>
  );
}
