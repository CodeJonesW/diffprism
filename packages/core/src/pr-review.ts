import type { GitHubReview } from "@diffprism/github";
import type { Annotation, PrReviewEvent, PrReviewSubmission, ReviewDecision } from "./types.js";

const EVENTS: readonly PrReviewEvent[] = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];

/** How a GitHub review is recorded as the session's decision. */
export const PR_EVENT_DECISION: Record<PrReviewEvent, ReviewDecision> = {
  APPROVE: "approved",
  REQUEST_CHANGES: "changes_requested",
  // A GitHub "Comment" review neither approves nor blocks; this is the
  // closest DiffPrism decision.
  COMMENT: "approved_with_comments",
};

/**
 * Turn the reviewer's submission into the GitHub review to post. Each picked
 * thread becomes an inline comment carrying the reviewer's opening message —
 * the agent's replies stay in DiffPrism.
 */
export function buildGitHubReview(
  submission: PrReviewSubmission,
  annotations: Annotation[],
): { review: GitHubReview } | { error: string } {
  if (!EVENTS.includes(submission.event)) {
    return { error: `Unknown review event: ${String(submission.event)}` };
  }

  const body = submission.summary?.trim() ?? "";
  if (!body && submission.event !== "APPROVE") {
    return { error: "GitHub needs a summary to request changes or comment" };
  }

  const comments: GitHubReview["comments"] = [];
  for (const id of submission.threadIds ?? []) {
    const thread = annotations.find((a) => a.id === id);
    if (!thread) return { error: `Thread not found: ${id}` };
    if (thread.author !== "reviewer") return { error: `Only your own threads can be posted: ${id}` };
    if (thread.dismissed) return { error: `Thread was dismissed: ${id}` };
    comments.push({
      path: thread.file,
      line: thread.line,
      side: thread.side === "old" ? "LEFT" : "RIGHT",
      body: thread.body,
    });
  }

  return { review: { event: submission.event, body, comments } };
}
