import { describe, it, expect } from "vitest";
import { buildGitHubReview } from "../pr-review.js";
import type { Annotation } from "../types.js";

function thread(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "t1", sessionId: "s1", file: "src/a.ts", line: 3, side: "new", body: "Why?", type: "question",
    confidence: 1, category: "other", source: { agent: "reviewer" }, createdAt: 1, author: "reviewer", ...over,
  };
}

describe("buildGitHubReview", () => {
  it("approves without a summary", () => {
    expect(buildGitHubReview({ event: "APPROVE" }, [])).toEqual({
      review: { event: "APPROVE", body: "", comments: [] },
    });
  });

  it.each(["REQUEST_CHANGES", "COMMENT"] as const)("needs a summary to %s — GitHub rejects it otherwise", (event) => {
    expect(buildGitHubReview({ event, summary: "  " }, [])).toEqual({
      error: "GitHub needs a summary to request changes or comment",
    });
  });

  it("posts only the threads picked, with the reviewer's opening message", () => {
    const picked = thread({ replies: [{ id: "r", author: "agent", agent: "bot", body: "An answer", createdAt: 2 }] });
    const result = buildGitHubReview({ event: "COMMENT", summary: "Notes", threadIds: ["t1"] }, [
      picked,
      thread({ id: "t2", body: "Not picked" }),
    ]);
    expect(result).toEqual({
      review: { event: "COMMENT", body: "Notes", comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", body: "Why?" }] },
    });
  });

  it("puts a thread on a deleted line on the base side", () => {
    const result = buildGitHubReview({ event: "APPROVE", threadIds: ["t1"] }, [thread({ side: "old" })]);
    expect("review" in result && result.review.comments[0].side).toBe("LEFT");
  });

  it("refuses dismissed, missing and agent threads", () => {
    expect(buildGitHubReview({ event: "APPROVE", threadIds: ["t1"] }, [thread({ dismissed: true })])).toHaveProperty("error");
    expect(buildGitHubReview({ event: "APPROVE", threadIds: ["nope"] }, [])).toHaveProperty("error");
    expect(buildGitHubReview({ event: "APPROVE", threadIds: ["t1"] }, [thread({ author: "agent" })])).toHaveProperty("error");
  });

  it("refuses an unknown event", () => {
    expect(buildGitHubReview({ event: "MERGE" as never }, [])).toHaveProperty("error");
  });
});
