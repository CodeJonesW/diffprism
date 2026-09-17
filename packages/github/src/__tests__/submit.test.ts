import { describe, it, expect, vi } from "vitest";
import { submitGitHubReview } from "../submit.js";

function createMockClient() {
  return {
    pulls: {
      createReview: vi.fn().mockResolvedValue({
        data: { id: 12345, html_url: "https://github.com/owner/repo/pull/42#pullrequestreview-12345" },
      }),
    },
  };
}

describe("submitGitHubReview", () => {
  it("posts the event, body and inline comments, and returns the review's URL", async () => {
    const client = createMockClient();

    const posted = await submitGitHubReview(client as never, "owner", "repo", 42, {
      event: "REQUEST_CHANGES",
      body: "The cache goes stale.",
      comments: [
        { path: "src/cache.ts", line: 4, side: "RIGHT", body: "Why build this lazily?" },
        { path: "src/cache.ts", line: 2, side: "LEFT", body: "Why drop includes()?" },
      ],
    });

    expect(posted).toEqual({
      reviewId: 12345,
      url: "https://github.com/owner/repo/pull/42#pullrequestreview-12345",
    });
    expect(client.pulls.createReview).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 42,
      event: "REQUEST_CHANGES",
      body: "The cache goes stale.",
      comments: [
        { path: "src/cache.ts", line: 4, side: "RIGHT", body: "Why build this lazily?" },
        { path: "src/cache.ts", line: 2, side: "LEFT", body: "Why drop includes()?" },
      ],
    });
  });

  it("omits an empty body — an approval needs none", async () => {
    const client = createMockClient();

    await submitGitHubReview(client as never, "owner", "repo", 42, { event: "APPROVE", body: "", comments: [] });

    expect(client.pulls.createReview.mock.calls[0][0]).not.toHaveProperty("body");
  });

  it("lets GitHub's errors reach the caller", async () => {
    const client = createMockClient();
    client.pulls.createReview.mockRejectedValue(new Error("Can not approve your own pull request"));

    await expect(
      submitGitHubReview(client as never, "owner", "repo", 42, { event: "APPROVE", body: "", comments: [] }),
    ).rejects.toThrow("Can not approve your own pull request");
  });
});
