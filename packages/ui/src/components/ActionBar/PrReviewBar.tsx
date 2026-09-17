import { useState } from "react";
import { Check, X, MessageSquare, XCircle, ExternalLink, AlertTriangle } from "lucide-react";
import type { PrReviewEvent } from "../../types";
import { useReviewStore } from "../../store/review";
import { useHttpApi } from "../../hooks/useHttpApi";
import { ACTION_BUTTON_STYLES } from "../../lib/semantic-colors";

interface PrReviewBarProps {
  onDismiss?: () => void;
}

/**
 * The end of a PR review: the reviewer's decision, posted to GitHub as a pull
 * request review. Threads are a conversation with the agent, so none goes out
 * unless the reviewer picks it.
 */
export function PrReviewBar({ onDismiss }: PrReviewBarProps) {
  const { annotations, reviewId, metadata } = useReviewStore();
  const { submitPrReview } = useHttpApi();
  const [summary, setSummary] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState<PrReviewEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postedUrl, setPostedUrl] = useState<string | null>(null);

  const pr = metadata?.githubPr;
  const yourThreads = annotations.filter((a) => a.author === "reviewer" && !a.dismissed);
  const needsSummary = !summary.trim();

  async function submit(event: PrReviewEvent) {
    if (!reviewId) return;
    setPosting(event);
    setError(null);
    const result = await submitPrReview(reviewId, {
      event,
      summary: summary.trim() || undefined,
      threadIds: yourThreads.filter((t) => picked.has(t.id)).map((t) => t.id),
    });
    setPosting(null);
    if (result.ok) {
      setPostedUrl(result.url);
    } else {
      setError(result.error);
    }
  }

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (postedUrl) {
    return (
      <div className="bg-surface border-t border-border px-4 py-3 flex-shrink-0 flex items-center gap-3">
        <Check className="w-4 h-4 text-success" />
        <span className="text-sm text-success font-medium">Review posted to GitHub</span>
        <a
          href={postedUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-accent hover:underline"
        >
          View on GitHub
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    );
  }

  const busy = posting !== null;
  const button = (event: PrReviewEvent, label: string, style: string, Icon: typeof Check, disabled: boolean) => (
    <button
      onClick={() => submit(event)}
      disabled={busy || disabled}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${style}`}
    >
      <Icon className="w-4 h-4" />
      {posting === event ? "Posting…" : label}
    </button>
  );

  return (
    <div className="bg-surface border-t border-border px-4 py-3 flex-shrink-0">
      <div className="text-xs text-text-secondary mb-2">
        Submit your review to GitHub{pr ? ` · ${pr.owner}/${pr.repo}#${pr.number}` : ""}
      </div>

      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Summary — optional to approve, required to request changes or comment"
        rows={3}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary text-sm placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent mb-3"
      />

      {yourThreads.length > 0 && (
        <fieldset className="mb-3">
          <legend className="text-xs text-text-secondary mb-1">
            Post your comments as inline review comments (your opening message only — agent replies stay here)
          </legend>
          <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
            {yourThreads.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-xs text-text-primary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={picked.has(t.id)}
                  onChange={() => toggle(t.id)}
                  className="rounded border-border accent-accent"
                />
                <span className="font-mono text-text-secondary">
                  {t.file}:{t.line}
                </span>
                <span className="truncate">{t.body}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-sm text-text-primary whitespace-pre-line">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-danger flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        {button("APPROVE", "Approve", ACTION_BUTTON_STYLES.approve, Check, false)}
        {button("REQUEST_CHANGES", "Request changes", ACTION_BUTTON_STYLES.reject, X, needsSummary)}
        {button("COMMENT", "Comment", ACTION_BUTTON_STYLES.comment, MessageSquare, needsSummary)}

        {onDismiss && (
          <>
            <div className="w-px h-6 bg-border" />
            <button
              onClick={onDismiss}
              disabled={busy}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 ${ACTION_BUTTON_STYLES.dismiss}`}
            >
              <XCircle className="w-4 h-4" />
              Close without posting
            </button>
          </>
        )}
      </div>
    </div>
  );
}
