import { useReviewStore } from "../store/review";
import { reviewKind } from "../lib/review-kind";
import type { ReviewKind } from "../lib/review-kind";

/**
 * The open review's kind (#254), for everything on the review screen: its
 * label, where the decision goes, and whether it's a pull request — which
 * picks the decision bar and turns the dojo's send-back on or off. Read from
 * the review's own metadata, so the badge and the bar can't disagree. The
 * session list reads a session's `pr` instead, which the server derives from
 * the same metadata.
 */
export function useReviewKind(): ReviewKind {
  const githubPr = useReviewStore((s) => s.metadata?.githubPr);
  const session = useReviewStore((s) => s.sessions.find((summary) => summary.id === s.reviewId));
  return reviewKind({
    diffRef: session?.diffRef,
    caller: session?.caller,
    source: session?.source,
    pr: githubPr ? `${githubPr.owner}/${githubPr.repo}#${githubPr.number}` : undefined,
  });
}
