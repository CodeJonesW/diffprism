import { CircleCheck, Clock, GitCommitHorizontal, Hourglass } from "lucide-react";
import { useReviewStore } from "../../store/review";
import { reviewStatus } from "../../lib/review-status";
import type { StatusTone } from "../../lib/review-status";
import { formatElapsed, useNow } from "../../lib/time";

const TONE: Record<StatusTone, { icon: typeof Clock; className: string }> = {
  "waiting-on-you": { icon: GitCommitHorizontal, className: "text-accent" },
  "waiting-on-agent": { icon: Hourglass, className: "text-text-primary" },
  decided: { icon: CircleCheck, className: "text-success" },
  stale: { icon: Clock, className: "text-warning" },
};

/**
 * Where a local review stands, above the decision buttons (#204, #274, #269):
 * whether a commit is waiting on it, whether the agent has findings to fix,
 * or what was decided. Nothing when there's nothing to say.
 */
export function ReviewStatus() {
  const summary = useReviewStore((s) => s.sessions.find((session) => session.id === s.reviewId));
  const annotations = useReviewStore((s) => s.annotations);
  const now = useNow();
  const lines = reviewStatus({ caller: summary?.caller, decision: summary?.decision, decidedAt: summary?.decidedAt, annotations });
  if (lines.length === 0) return null;

  return (
    <div role="status" aria-label="Review status" className="bg-surface border-t border-border px-4 py-2 space-y-1">
      {lines.map((line) => {
        const { icon: Icon, className } = TONE[line.tone];
        const left = line.until !== undefined ? line.until - now : undefined;
        return (
          <p key={line.text} className={`flex items-start gap-2 text-sm ${className}`}>
            <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {line.text}
              {left !== undefined && left > 0 && (
                <span className="text-text-secondary"> It waits another <span className="font-mono">{formatElapsed(left)}</span>.</span>
              )}
            </span>
          </p>
        );
      })}
    </div>
  );
}
