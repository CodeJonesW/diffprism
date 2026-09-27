import { useState } from "react";
import { History } from "lucide-react";
import { useReviewStore } from "../../store/review";
import { useHttpApi } from "../../hooks/useHttpApi";

/**
 * What changed since the reviewer last looked (#265). A round of fixes
 * arrives as the whole diff again; this says which files moved, lets the
 * reviewer see only the new hunks, and marks the round seen.
 */
export function SinceBanner() {
  const since = useReviewStore((s) => s.since);
  const sinceOnly = useReviewStore((s) => s.sinceOnly);
  const setSinceOnly = useReviewStore((s) => s.setSinceOnly);
  const selectFile = useReviewStore((s) => s.selectFile);
  const reviewId = useReviewStore((s) => s.reviewId);
  const { markSeen } = useHttpApi();
  const [markError, setMarkError] = useState<string | null>(null);

  if (!since || since.files.length === 0) return null;

  async function markAllSeen(sessionId: string) {
    setMarkError(null);
    const result = await markSeen(sessionId);
    // The banner leaves when the server says so; if it can't, say why rather than look stuck.
    if (!result.ok) setMarkError(result.error ?? "Couldn't reach the server");
  }

  const present = since.files.filter((f) => f.status !== "removed");
  const removed = since.files.filter((f) => f.status === "removed");
  const additions = since.files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = since.files.reduce((sum, f) => sum + f.deletions, 0);
  // Removals are changes too: a revert adds nothing and would otherwise look like nothing.
  const gone = since.files.reduce((sum, f) => sum + f.droppedHunks, 0);
  const count = since.files.length;

  return (
    <div
      role="status"
      aria-label="Changed since you last looked"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-accent/30 bg-accent/10 text-xs"
    >
      <History className="w-3.5 h-3.5 text-accent flex-shrink-0" />
      <span className="text-text-primary font-medium">
        Changed since you last looked: {count} file{count === 1 ? "" : "s"}
        {additions > 0 && <span className="text-success font-mono"> +{additions}</span>}
        {deletions > 0 && <span className="text-danger font-mono"> −{deletions}</span>}
        {gone > 0 && (
          <span className="text-text-secondary">
            {" "}
            · {gone} change{gone === 1 ? "" : "s"} you saw {gone === 1 ? "is" : "are"} gone
          </span>
        )}
      </span>
      <span className="flex flex-wrap gap-x-2">
        {present.map((f) => (
          <button
            key={f.key}
            onClick={() => selectFile(f.key)}
            className="font-mono text-accent hover:underline"
            title={f.status === "added" ? "New to this review" : "Changed since you last looked"}
          >
            {f.path.split("/").pop()}
          </button>
        ))}
        {removed.map((f) => (
          <span key={f.key} className="font-mono text-text-secondary line-through" title="No longer in the diff">
            {f.path.split("/").pop()}
          </span>
        ))}
      </span>
      <span className="flex-1" />
      <button onClick={() => setSinceOnly(!sinceOnly)} className="text-accent font-medium hover:underline">
        {sinceOnly ? "Show all changes" : "Show only these changes"}
      </button>
      {reviewId && (
        <button onClick={() => markAllSeen(reviewId)} className="text-text-secondary hover:text-text-primary hover:underline">
          Mark as seen
        </button>
      )}
      {markError && <span className="w-full text-danger">Couldn't mark as seen: {markError}</span>}
    </div>
  );
}
