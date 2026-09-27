import { Splitter } from "@mantine/core";
import { PanelBottomOpen, Swords } from "lucide-react";
import { BriefingBar } from "./BriefingBar";
import { ReasoningPanel } from "./ReasoningPanel";
import { FileBrowser } from "./FileBrowser";
import { DiffViewer } from "./DiffViewer";
import { ActionBar, PrReviewBar } from "./ActionBar";
import { HotkeyGuide } from "./HotkeyGuide";
import { WorkflowTips } from "./WorkflowTips";
import { AnnotationPanel, annotationPanelTitle } from "./AnnotationPanel";
import { DojoPanel } from "./DojoPanel";
import { SinceBanner } from "./SinceBanner";
import { ReviewStatus } from "./ReviewStatus";
import { useSavedPane } from "../hooks/useSavedPane";
import { useReviewStore } from "../store/review";
import { useReviewKind } from "../hooks/useReviewKind";
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
  const { annotations, dismissAnnotation, selectFile, focusAnnotation, diffSet, metadata, reviewId, dojo } = useReviewStore();
  const agentReadAt = useReviewStore((s) => s.sessions.find((session) => session.id === s.reviewId)?.agentReadAt);
  const isPrReview = useReviewKind().kind === "pr";
  const sidebar = useSavedPane("review-sidebar", 0);
  // Both panes stay mounted: Mantine sizes a splitter's panes once, so one
  // appearing later wouldn't fit, and remounting would reset the file list.
  // Until the review has threads, their pane is simply hidden.
  const hasThreads = annotations.length > 0;
  const threads = useSavedPane("review-threads", 1, hasThreads);
  const threadsSize = parseFloat(String(threads.defaultSize));
  // Every review has the dojo (#231): a PR, or a local change such as the
  // commit gate's staged diff (#238).
  const dojoPane = useSavedPane("review-dojo", 1);

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
      <SinceBanner />
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

        {/* Main area — the diff, and the dojo beside it */}
        <Splitter.Pane defaultSize={1} className="flex overflow-hidden">
          <Splitter
            className="flex-1 min-w-0"
            withHandle={false}
            lineSize={1}
            classNames={{ handle: "bg-border" }}
            {...dojoPane.splitterProps}
          >
            <Splitter.Pane defaultSize={1} className="flex overflow-hidden">
              <DiffViewer />
            </Splitter.Pane>
            <Splitter.Pane defaultSize={dojoPane.defaultSize} min="280px" max="640px" collapsible className="overflow-hidden">
              {reviewId && (
                <DojoPanel
                  sessionId={reviewId}
                  dojo={dojo}
                  onNavigate={(finding) => {
                    navigateToFile(finding.file);
                    if (finding.annotationId) focusAnnotation(finding.annotationId);
                  }}
                  onHide={() => dojoPane.setCollapsed(true)}
                  // A local review's findings can go back to the agent that made the change (#238).
                  sendBack={isPrReview ? undefined : { annotations, agentReadAt }}
                />
              )}
            </Splitter.Pane>
          </Splitter>
          {/* Hidden, the dojo leaves a rail to bring it back. */}
          {dojoPane.collapsed && (
            <div className="w-9 flex-shrink-0 flex flex-col items-center py-3 bg-surface border-l border-border">
              <button
                onClick={() => dojoPane.setCollapsed(false)}
                className="p-1 rounded hover:bg-border/50 text-text-secondary hover:text-text-primary transition-colors"
                title="Review dojo"
                aria-label="Review dojo"
              >
                <Swords className={`w-3.5 h-3.5 ${dojo?.status === "running" ? "text-accent animate-pulse" : ""}`} />
              </button>
            </div>
          )}
        </Splitter.Pane>
      </Splitter>

      {/* Bottom — the decision. A PR's goes to GitHub; a local review's goes back to the agent. */}
      {isPrReview ? (
        <PrReviewBar onDismiss={onDismiss} />
      ) : (
        <>
          {/* Where it stands: a commit waiting on it, findings with the agent, or decided. */}
          <ReviewStatus />
          <ActionBar
            onSubmit={onSubmit}
            onDismiss={onDismiss}
            isWatchMode={isWatchMode}
            watchSubmitted={watchSubmitted}
            hasUnreviewedChanges={hasUnreviewedChanges}
          />
        </>
      )}
      <HotkeyGuide />
      <WorkflowTips />
    </div>
  );
}
