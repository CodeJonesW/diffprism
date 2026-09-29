import { useState } from "react";
import { Bot, CircleCheck, Clock, GitCommitHorizontal, Hourglass } from "lucide-react";
import { useReviewStore } from "../../store/review";
import { reviewStatus } from "../../lib/review-status";
import type { StatusTone } from "../../lib/review-status";
import { awaitingAgent } from "../../lib/threads";
import { formatElapsed, useNow } from "../../lib/time";
import { useAgentPickup } from "../../hooks/useAgentPickup";
import { useHttpApi } from "../../hooks/useHttpApi";
import { useReviewKind } from "../../hooks/useReviewKind";

const TONE: Record<StatusTone, { icon: typeof Clock; className: string }> = {
  "waiting-on-you": { icon: GitCommitHorizontal, className: "text-accent" },
  "waiting-on-agent": { icon: Hourglass, className: "text-text-primary" },
  decided: { icon: CircleCheck, className: "text-success" },
  stale: { icon: Clock, className: "text-warning" },
};

/**
 * Where a local review stands, above the decision buttons (#204, #274, #269):
 * whether a commit is waiting on it, whether the agent has findings to fix,
 * or what was decided. With findings and nothing listening for them, it says
 * how to get them to an agent, and can start one to fix them (#279). Nothing
 * when there's nothing to say.
 */
export function ReviewStatus() {
  const summary = useReviewStore((s) => s.sessions.find((session) => session.id === s.reviewId));
  const annotations = useReviewStore((s) => s.annotations);
  const { fixable } = useReviewKind();
  const { startFixer } = useHttpApi();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const now = useNow();
  const pickup = useAgentPickup(annotations, summary?.agentReadAt);
  const listening = annotations.filter(awaitingAgent).some((thread) => pickup(thread) !== "unheard");
  const lines = reviewStatus({
    caller: summary?.caller,
    decision: summary?.decision,
    decidedAt: summary?.decidedAt,
    annotations,
    listening,
    fixer: summary?.fixer,
    fixable,
  });
  if (lines.length === 0) return null;

  async function start() {
    if (!summary) return;
    setStarting(true);
    setStartError(null);
    // Once it's running, the session's summary says so.
    const result = await startFixer(summary.id);
    if (!result.ok) setStartError(result.error ?? "It didn't start.");
    setStarting(false);
  }

  return (
    <div role="status" aria-label="Review status" className="bg-surface border-t border-border px-4 py-2 space-y-1">
      {lines.map((line) => {
        const { icon: Icon, className } = TONE[line.tone];
        const left = line.until !== undefined ? line.until - now : undefined;
        return (
          <div key={line.text}>
            <p className={`flex items-start gap-2 text-sm ${className}`}>
              <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {line.text}
                {left !== undefined && left > 0 && (
                  <span className="text-text-secondary"> It waits another <span className="font-mono">{formatElapsed(left)}</span>.</span>
                )}
              </span>
            </p>
            {line.action === "start-fixer" && (
              <div className="flex items-center gap-3 mt-1.5 ml-6">
                <button
                  onClick={start}
                  disabled={starting}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Bot className="w-3.5 h-3.5" />
                  {starting ? "Starting…" : "Start an agent to fix these"}
                </button>
                <span className="text-xs text-text-secondary">
                  Your Review agent. It can edit files in this repository (not .git), has no shell and doesn't commit
                  {summary?.diffRef === "staged" ? "; DiffPrism stages its fixes" : ""}. Check its changes like any other.
                </span>
              </div>
            )}
            {line.action === "start-fixer" && startError && (
              <p role="alert" className="mt-1 ml-6 text-xs text-danger">
                Couldn't start it: {startError}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
