import { describe, it, expect, vi } from "vitest";
import { submitGitHubReview } from "../submit.js";
import type { ReviewResult } from "@diffprism/core";

function createMockClient() {
  return {
    pulls: {
      createReview: vi.fn().mockResolvedValue({ data: { id: 12345 } }),
    },
  };
}

describe("submitGitHubReview", () => {
  it("maps approved to APPROVE event", async () => {
    const client = createMockClient();
    const result: ReviewResult = {
      decision: "approved",
      comments: [],
      summary: "Looks good!",
    };

    const posted = await submitGitHubReview(
      client as never,
      "owner",
      "repo",
      42,
      result,
    );

    expect(posted).toEqual({ reviewId: 12345 });
    expect(client.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "APPROVE",
        owner: "owner",
        repo: "repo",
        pull_number: 42,
      }),
    );
  });

  it("maps changes_requested to REQUEST_CHANGES event", async () => {
    const client = createMockClient();
    const result: ReviewResult = {
      decision: "changes_requested",
      comments: [],
      summary: "Please fix these issues.",
    };

    await submitGitHubReview(client as never, "owner", "repo", 42, result);

    expect(client.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "REQUEST_CHANGES",
      }),
    );
  });

  it("maps approved_with_comments to COMMENT event", async () => {
    const client = createMockClient();
    const result: ReviewResult = {
      decision: "approved_with_comments",
      comments: [],
      summary: "Approved with some notes.",
    };

    await submitGitHubReview(client as never, "owner", "repo", 42, result);

    expect(client.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "COMMENT",
      }),
    );
  });

  it("returns null for dismissed reviews", async () => {
    const client = createMockClient();
    const result: ReviewResult = {
      decision: "dismissed",
      comments: [],
    };

    const posted = await submitGitHubReview(
      client as never,
      "owner",
      "repo",
      42,
      result,
    );

    expect(posted).toBeNull();
    expect(client.pulls.createReview).not.toHaveBeenCalled();
  });

  it("includes inline comments with type prefixes", async () => {
    const client = createMockClient();
    const result: ReviewResult = {
      decision: "changes_requested",
      comments: [
        { file: "src/index.ts", line: 10, body: "This is wrong", type: "must_fix" },
        { file: "src/utils.ts", line: 20, body: "Consider this", type: "suggestion" },
        { file: "src/app.ts", line: 5, body: "Why this?", type: "question" },
        { file: "src/config.ts", line: 3, body: "Minor style", type: "nitpick" },
      ],
    };

    await submitGitHubReview(client as never, "owner", "repo", 42, result);

    const call = client.pulls.createReview.mock.calls[0][0];
    expect(call.comments).toHaveLength(4);
    expect(call.comments[0]).toEqual({
      path: "src/index.ts",
      line: 10,
      body: "**Must Fix:** This is wrong",
    });
    expect(call.comments[1]).toEqual({
      path: "src/utils.ts",
      line: 20,
      body: "**Suggestion:** Consider this",
    });
    expect(call.comments[2]).toEqual({
      path: "src/app.ts",
      line: 5,
      body: "**Question:** Why this?",
    });
    expect(call.comments[3]).toEqual({
      path: "src/config.ts",
      line: 3,
      body: "**Nitpick:** Minor style",
    });
  });

  it("includes summary in review body", async () => {
    const client = createMockClient();
    const result: ReviewResult = {
      decision: "approved",
      comments: [],
      summary: "Great work!",
    };

    await submitGitHubReview(client as never, "owner", "repo", 42, result);

    const call = client.pulls.createReview.mock.calls[0][0];
    expect(call.body).toContain("Great work!");
    expect(call.body).toContain("DiffPrism");
  });

  it("filters out comments with line 0", async () => {
    const client = createMockClient();
    const result: ReviewResult = {
      decision: "approved_with_comments",
      comments: [
        { file: "src/index.ts", line: 0, body: "General comment", type: "suggestion" },
        { file: "src/index.ts", line: 5, body: "Inline comment", type: "suggestion" },
      ],
    };

    await submitGitHubReview(client as never, "owner", "repo", 42, result);

    const call = client.pulls.createReview.mock.calls[0][0];
    expect(call.comments).toHaveLength(1);
    expect(call.comments[0].line).toBe(5);
  });
});
