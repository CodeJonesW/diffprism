import { BriefingBar } from "./BriefingBar";
import { ReasoningPanel } from "./ReasoningPanel";
import { FileBrowser } from "./FileBrowser";
import { DiffViewer } from "./DiffViewer";
import { ActionBar, PrReviewBar } from "./ActionBar";
import { HotkeyGuide } from "./HotkeyGuide";
import { WorkflowTips } from "./WorkflowTips";
import { AnnotationPanel } from "./AnnotationPanel";
import { useReviewStore } from "../store/review";
import type { ReviewResult } from "../types";
import { getFileKey } from "../lib/file-key";

interface ReviewViewProps {
  onSubmit: (result: ReviewResult) => void;
  onDismiss?: () => void;
  isWatchMode?: boolean;
  watchSubmitted?: boolean;
  hasUnreviewedChanges?: boolean;
}

export function ReviewView({ onSubmit, onDismiss, isWatchMode, watchSubmitted, hasUnreviewedChanges }: ReviewViewProps) {
  const { annotations, dismissAnnotation, selectFile, focusAnnotation, diffSet, metadata } = useReviewStore();
  const agentReadAt = useReviewStore((s) => s.sessions.find((session) => session.id === s.reviewId)?.agentReadAt);
  const isPrReview = !!metadata?.githubPr;

  // Resolve raw file paths (from annotations) to file keys (which may have stage prefixes)
  const navigateToFile = (filePath: string) => {
    if (!diffSet) return;
    // Try exact match first (works for non-working-copy diffs)
    const exact = diffSet.files.find((f) => getFileKey(f) === filePath);
    if (exact) {
      selectFile(filePath);
      return;
    }
    // Try matching by raw path (for working-copy diffs with staged:/unstaged: prefixes)
    const byPath = diffSet.files.find((f) => f.path === filePath);
    if (byPath) {
      selectFile(getFileKey(byPath));
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <BriefingBar />
      <ReasoningPanel />
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — File Browser + Annotations */}
        <div className="w-[280px] flex-shrink-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0">
            <FileBrowser onSubmit={onSubmit} />
          </div>
          <AnnotationPanel
            annotations={annotations}
            onDismiss={dismissAnnotation}
            agentReadAt={agentReadAt}
            onNavigate={(annotation) => {
              navigateToFile(annotation.file);
              // A dismissed thread isn't drawn on the diff, so there is nothing to scroll to.
              if (!annotation.dismissed) focusAnnotation(annotation.id);
            }}
          />
        </div>

        {/* Main area — Diff Viewer */}
        <DiffViewer />
      </div>

      {/* Bottom — the decision. A PR's goes to GitHub; a local review's goes back to the agent. */}
      {isPrReview ? (
        <PrReviewBar onDismiss={onDismiss} />
      ) : (
        <ActionBar
          onSubmit={onSubmit}
          onDismiss={onDismiss}
          isWatchMode={isWatchMode}
          watchSubmitted={watchSubmitted}
          hasUnreviewedChanges={hasUnreviewedChanges}
        />
      )}
      <HotkeyGuide />
      <WorkflowTips />
    </div>
  );
}
