import type { Octokit } from "@octokit/rest";
import type { ReviewResult, ReviewComment } from "@diffprism/core";

type GitHubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/**
 * Map a DiffPrism ReviewResult to a GitHub pull request review.
 *
 * Decision mapping:
 * - approved → APPROVE
 * - changes_requested → REQUEST_CHANGES
 * - approved_with_comments → COMMENT
 * - dismissed → skipped (no GitHub action)
 *
 * Inline comments with file/line become PR review comments.
 * The summary becomes the review body.
 */
export async function submitGitHubReview(
  client: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  result: ReviewResult,
): Promise<{ reviewId: number } | null> {
  if (result.decision === "dismissed") {
    return null;
  }

  const eventMap: Record<string, GitHubReviewEvent> = {
    approved: "APPROVE",
    changes_requested: "REQUEST_CHANGES",
    approved_with_comments: "COMMENT",
  };

  const event = eventMap[result.decision];
  if (!event) {
    return null;
  }

  // Build inline comments from ReviewComments that have file+line
  const comments = result.comments
    .filter((c) => c.file && c.line > 0)
    .map((c) => formatReviewComment(c));

  const body = buildReviewBody(result);

  const { data } = await client.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event,
    body,
    comments,
  });

  return { reviewId: data.id };
}

/**
 * Format a DiffPrism ReviewComment as a GitHub review comment.
 */
function formatReviewComment(comment: ReviewComment): {
  path: string;
  line: number;
  body: string;
} {
  const typePrefix = getCommentTypePrefix(comment.type);
  return {
    path: comment.file,
    line: comment.line,
    body: `${typePrefix}${comment.body}`,
  };
}

function getCommentTypePrefix(
  type: ReviewComment["type"],
): string {
  switch (type) {
    case "must_fix":
      return "**Must Fix:** ";
    case "suggestion":
      return "**Suggestion:** ";
    case "question":
      return "**Question:** ";
    case "nitpick":
      return "**Nitpick:** ";
    default:
      return "";
  }
}

/**
 * Build the review body from the ReviewResult summary and inline comment count.
 */
function buildReviewBody(result: ReviewResult): string {
  const parts: string[] = [];

  if (result.summary) {
    parts.push(result.summary);
  }

  if (result.comments.length > 0) {
    const inlineCount = result.comments.filter((c) => c.file && c.line > 0).length;
    if (inlineCount > 0) {
      parts.push(`*${inlineCount} inline comment${inlineCount !== 1 ? "s" : ""} attached.*`);
    }
  }

  parts.push("\n---\n*Reviewed with [DiffPrism](https://github.com/anthropics/diffprism)*");

  return parts.join("\n\n");
}
