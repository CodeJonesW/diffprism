import { useState } from "react";
import { Check, X, XCircle, MessageSquare, GitPullRequest } from "lucide-react";
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
  const [postToGithub, setPostToGithub] = useState(false);
  const { diffSet, fileStatuses, comments, metadata } = useReviewStore();
  const isGitHubPr = !!metadata?.githubPr;

  const totalAdditions =
    diffSet?.files.reduce((sum, f) => sum + f.additions, 0) ?? 0;
  const totalDeletions =
    diffSet?.files.reduce((sum, f) => sum + f.deletions, 0) ?? 0;
  const fileCount = diffSet?.files.length ?? 0;

  function handleSubmit(decision: ReviewDecision) {
    const hasStatuses = Object.values(fileStatuses).some(
      (s) => s !== "unreviewed",
    );
    onSubmit({
      decision,
      comments,
      fileStatuses: hasStatuses ? fileStatuses : undefined,
      summary: summary.trim() || undefined,
      postToGithub: isGitHubPr && postToGithub ? true : undefined,
    });
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

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleSubmit("approved")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${ACTION_BUTTON_STYLES.approve}`}
        >
          <Check className="w-4 h-4" />
          Approve
        </button>

        <button
          onClick={() => handleSubmit("changes_requested")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${ACTION_BUTTON_STYLES.reject}`}
        >
          <X className="w-4 h-4" />
          Request Changes
        </button>

        <button
          onClick={() => handleSubmit("approved_with_comments")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${ACTION_BUTTON_STYLES.comment}`}
        >
          <MessageSquare className="w-4 h-4" />
          Approve with Comments
        </button>

        {onDismiss && (
          <>
            <div className="w-px h-6 bg-border" />
            <button
              onClick={onDismiss}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${ACTION_BUTTON_STYLES.dismiss}`}
            >
              <XCircle className="w-4 h-4" />
              Dismiss
            </button>
          </>
        )}

        {isGitHubPr && (
          <>
            <div className="w-px h-6 bg-border" />
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={postToGithub}
                onChange={(e) => setPostToGithub(e.target.checked)}
                className="rounded border-border accent-accent"
              />
              <GitPullRequest className="w-3.5 h-3.5 text-accent" />
              Post to GitHub
            </label>
          </>
        )}
      </div>
    </div>
  );
}
