import { Splitter } from "@mantine/core";
import { PanelBottomOpen } from "lucide-react";
import { BriefingBar } from "./BriefingBar";
import { ReasoningPanel } from "./ReasoningPanel";
import { FileBrowser } from "./FileBrowser";
import { DiffViewer } from "./DiffViewer";
import { ActionBar, PrReviewBar } from "./ActionBar";
import { HotkeyGuide } from "./HotkeyGuide";
import { WorkflowTips } from "./WorkflowTips";
import { AnnotationPanel, annotationPanelTitle } from "./AnnotationPanel";
import { useSavedPane } from "../hooks/useSavedPane";
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
  const sidebar = useSavedPane("review-sidebar", 0);
  // Both panes stay mounted: Mantine sizes a splitter's panes once, so one
  // appearing later wouldn't fit, and remounting would reset the file list.
  // Until the review has threads, their pane is simply hidden.
  const hasThreads = annotations.length > 0;
  const threads = useSavedPane("review-threads", 1, hasThreads);
  const threadsSize = parseFloat(String(threads.defaultSize));

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
      <Splitter
        className="flex-1 min-h-0"
        withHandle={false}
        lineSize={1}
        classNames={{ handle: "bg-border" }}
        {...sidebar.splitterProps}
      >
        {/* Left sidebar — File Browser + Annotations. Stays mounted when
            collapsed, so FileBrowser's keyboard shortcuts keep working. */}
        <Splitter.Pane
          defaultSize={sidebar.defaultSize}
          min="200px"
          max="600px"
          collapsible
          className="flex flex-col overflow-hidden"
        >
          <Splitter
            orientation="vertical"
            className="flex-1 min-h-0"
            withHandle={false}
            lineSize={1}
            classNames={{ handle: hasThreads ? "bg-border" : "hidden" }}
            {...threads.splitterProps}
          >
            <Splitter.Pane defaultSize={100 - threadsSize} min={20} className="overflow-hidden">
              <FileBrowser onSubmit={onSubmit} />
            </Splitter.Pane>
            <Splitter.Pane defaultSize={threadsSize} min={10} collapsible className="overflow-hidden">
              <AnnotationPanel
                annotations={annotations}
                onDismiss={dismissAnnotation}
                agentReadAt={agentReadAt}
                onNavigate={(annotation) => {
                  navigateToFile(annotation.file);
                  // A dismissed thread isn't drawn on the diff, so there is nothing to scroll to.
                  if (!annotation.dismissed) focusAnnotation(annotation.id);
                }}
                onHide={() => threads.setCollapsed(true)}
              />
            </Splitter.Pane>
          </Splitter>
          {/* Hidden threads leave a bar to bring them back — their own header went with them. */}
          {hasThreads && threads.collapsed && (
            <button
              onClick={() => threads.setCollapsed(false)}
              className="flex items-center gap-2 px-4 py-2 border-t border-border text-xs font-semibold text-text-secondary uppercase tracking-wide hover:text-text-primary cursor-pointer"
              title="Show threads"
            >
              <PanelBottomOpen className="w-3.5 h-3.5" />
              {annotationPanelTitle(annotations)}
            </button>
          )}
        </Splitter.Pane>

        {/* Main area — Diff Viewer */}
        <Splitter.Pane defaultSize={1} className="flex overflow-hidden">
          <DiffViewer />
        </Splitter.Pane>
      </Splitter>

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
