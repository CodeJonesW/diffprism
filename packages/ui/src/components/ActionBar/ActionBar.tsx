import { useState } from "react";
import { Check, X, XCircle, MessageSquare, AlertTriangle } from "lucide-react";
import type { ReviewResult, ReviewDecision } from "../../types";
import { useReviewStore } from "../../store/review";
import { ACTION_BUTTON_STYLES } from "../../lib/semantic-colors";

interface ActionBarProps {
  onSubmit: (result: ReviewResult) => void;
  onDismiss?: () => void;
  isWatchMode?: boolean;
  watchSubmitted?: boolean;
  hasUnreviewedChanges?: boolean;
}

export function ActionBar({ onSubmit, onDismiss, isWatchMode, watchSubmitted, hasUnreviewedChanges }: ActionBarProps) {
  const [summary, setSummary] = useState("");
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(null);
  const { diffSet, fileStatuses, comments, draftComment, saveDraftComment, setActiveCommentKey, setDraftComment, verdict } = useReviewStore();
  const sending = verdict.state === "sending";

  const totalAdditions =
    diffSet?.files.reduce((sum, f) => sum + f.additions, 0) ?? 0;
  const totalDeletions =
    diffSet?.files.reduce((sum, f) => sum + f.deletions, 0) ?? 0;
  const fileCount = diffSet?.files.length ?? 0;

  const hasDraft = !!(draftComment && draftComment.body.trim());

  function doSubmit(decision: ReviewDecision) {
    const hasStatuses = Object.values(fileStatuses).some(
      (s) => s !== "unreviewed",
    );
    onSubmit({
      decision,
      comments: useReviewStore.getState().comments,
      fileStatuses: hasStatuses ? fileStatuses : undefined,
      summary: summary.trim() || undefined,
    });
  }

  function handleSubmit(decision: ReviewDecision) {
    if (hasDraft) {
      setPendingDecision(decision);
      return;
    }
    doSubmit(decision);
  }

  function handleSaveAndSubmit() {
    if (pendingDecision) {
      saveDraftComment();
      doSubmit(pendingDecision);
      setPendingDecision(null);
    }
  }

  function handleDiscardAndSubmit() {
    if (pendingDecision) {
      setDraftComment(null);
      setActiveCommentKey(null);
      doSubmit(pendingDecision);
      setPendingDecision(null);
    }
  }

  /** While one decision is on its way, none can be sent: the clicked one says so. */
  function decisionButton(
    decision: ReviewDecision,
    label: string,
    style: string,
    Icon: typeof Check,
    onClick: () => void,
  ) {
    const thisOne = verdict.state === "sending" && verdict.decision === decision;
    return (
      <button
        onClick={onClick}
        disabled={sending}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
      >
        <Icon className="w-4 h-4" />
        {thisOne ? "Sending…" : label}
      </button>
    );
  }

  // Watch mode: submitted with no new changes — compact bar
  if (isWatchMode && watchSubmitted && !hasUnreviewedChanges) {
    return (
      <div className="bg-surface border-t border-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Check className="w-4 h-4 text-success" />
          <span className="text-sm text-success font-medium">
            Review submitted
          </span>
          <span className="relative flex h-2 w-2 ml-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span className="text-xs text-text-secondary">Watching for changes...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border-t border-border px-4 py-3 flex-shrink-0">
      {/* New changes banner in watch mode */}
      {isWatchMode && watchSubmitted && hasUnreviewedChanges && (
        <div className="flex items-center gap-2 mb-3 text-xs text-accent">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-info" />
          </span>
          New changes detected
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3">
        <span className="text-text-secondary text-xs">
          {fileCount} file{fileCount !== 1 ? "s" : ""} changed
        </span>
        {totalAdditions > 0 && (
          <span className="text-success text-xs font-mono">
            +{totalAdditions}
          </span>
        )}
        {totalDeletions > 0 && (
          <span className="text-danger text-xs font-mono">
            -{totalDeletions}
          </span>
        )}
        {comments.length > 0 && (
          <span className="flex items-center gap-1 text-accent text-xs">
            <MessageSquare className="w-3 h-3" />
            {comments.length} comment{comments.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Comment textarea */}
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Leave a summary comment (optional)..."
        rows={3}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary text-sm placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent mb-3"
      />

      {/* Unsaved comment warning */}
      {pendingDecision && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2.5 rounded-lg bg-warning/10 border border-warning/30">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
          <span className="text-sm text-text-primary">
            You have an unsaved comment. Save it before submitting?
          </span>
          <div className="flex-1" />
          <button
            onClick={handleSaveAndSubmit}
            className="px-3 py-1.5 text-xs font-medium rounded bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors cursor-pointer"
          >
            Save & Submit
          </button>
          <button
            onClick={handleDiscardAndSubmit}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            Discard & Submit
          </button>
          <button
            onClick={() => setPendingDecision(null)}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* The decision didn't reach the server: say why, keep everything, let them send again. */}
      {verdict.state === "failed" && (
        <div role="alert" className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-sm text-text-primary">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-danger flex-shrink-0" />
          <span>
            Your decision wasn't sent: {verdict.error}. Whatever is waiting on this review hasn't got it. Choose again to resend.
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {decisionButton("approved", "Approve", ACTION_BUTTON_STYLES.approve, Check, () => handleSubmit("approved"))}
        {decisionButton("changes_requested", "Request Changes", ACTION_BUTTON_STYLES.reject, X, () => handleSubmit("changes_requested"))}
        {decisionButton("approved_with_comments", "Approve with Comments", ACTION_BUTTON_STYLES.comment, MessageSquare, () => handleSubmit("approved_with_comments"))}

        {onDismiss && (
          <>
            <div className="w-px h-6 bg-border" />
            {decisionButton("dismissed", "Dismiss", ACTION_BUTTON_STYLES.dismiss, XCircle, onDismiss)}
          </>
        )}

      </div>
    </div>
  );
}
