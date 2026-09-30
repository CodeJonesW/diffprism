import type { Octokit } from "@octokit/rest";

export type GitHubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** An inline comment on a pull request review. `LEFT` is the base file, `RIGHT` the head. */
export interface GitHubReviewComment {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export interface GitHubReview {
  event: GitHubReviewEvent;
  /** Required by GitHub for REQUEST_CHANGES and COMMENT. */
  body: string;
  comments: GitHubReviewComment[];
}

/**
 * Submit a pull request review. Errors from GitHub (bad token, approving your
 * own PR, a line outside the diff) propagate to the caller.
 */
export async function submitGitHubReview(
  client: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  review: GitHubReview,
): Promise<{ reviewId: number; url: string }> {
  const { data } = await client.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event: review.event,
    ...(review.body ? { body: review.body } : {}),
    comments: review.comments,
  });

  return { reviewId: data.id, url: data.html_url };
}

/**
 * Post one inline comment on a pull request, straight away, outside any
 * review (#289): a dojo finding the reviewer chose to put on the PR. It's on
 * `commitId` (the head the review read), so its line is that commit's.
 * Errors from GitHub — a line outside the diff, a bad token — propagate.
 */
export async function postPullRequestComment(
  client: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  comment: GitHubReviewComment & { commitId: string },
): Promise<{ url: string }> {
  const { data } = await client.pulls.createReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: comment.commitId,
    path: comment.path,
    line: comment.line,
    side: comment.side,
    body: comment.body,
  });
  return { url: data.html_url };
}
