import { useState } from "react";
import { Check, X, MessageSquare } from "lucide-react";
import type { ReviewResult, ReviewDecision } from "../../types";
import { useReviewStore } from "../../store/review";

interface ActionBarProps {
  onSubmit: (result: ReviewResult) => void;
}

export function ActionBar({ onSubmit }: ActionBarProps) {
  const [summary, setSummary] = useState("");
  const { diffSet, fileStatuses } = useReviewStore();

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
      comments: [],
      fileStatuses: hasStatuses ? fileStatuses : undefined,
      summary: summary.trim() || undefined,
    });
  }

  return (
    <div className="bg-surface border-t border-border px-4 py-3 flex-shrink-0">
      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3">
        <span className="text-text-secondary text-xs">
          {fileCount} file{fileCount !== 1 ? "s" : ""} changed
        </span>
        {totalAdditions > 0 && (
          <span className="text-green-400 text-xs font-mono">
            +{totalAdditions}
          </span>
        )}
        {totalDeletions > 0 && (
          <span className="text-red-400 text-xs font-mono">
            -{totalDeletions}
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
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30 hover:border-green-500/50 cursor-pointer"
        >
          <Check className="w-4 h-4" />
          Approve
        </button>

        <button
          onClick={() => handleSubmit("changes_requested")}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 hover:border-red-500/50 cursor-pointer"
        >
          <X className="w-4 h-4" />
          Request Changes
        </button>

        <button
          onClick={() => handleSubmit("approved_with_comments")}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 hover:border-blue-500/50 cursor-pointer"
        >
          <MessageSquare className="w-4 h-4" />
          Approve with Comments
        </button>
      </div>
    </div>
  );
}
