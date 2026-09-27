/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { reviewStatus } from "../lib/review-status";
import { ReviewStatus } from "../components/ReviewStatus";
import { useReviewStore } from "../store/review";
import type { Annotation, SessionSummary } from "../types";

// ─── #204, #274, #269: where a local review stands ───

const thread = (id: string, replies: Annotation["replies"] = []): Annotation => ({
  id, sessionId: "s1", file: "a.ts", line: 1, side: "new", body: "[major] x", type: "finding", confidence: 1,
  category: "other", source: { agent: "Review dojo", tool: "dojo" }, author: "agent", createdAt: 1, replies,
});
const sent = (id: string) => thread(id, [{ id: `${id}-r`, author: "reviewer", body: "Please fix this.", createdAt: 2 }]);
const fixed = (id: string) =>
  thread(id, [
    { id: `${id}-r`, author: "reviewer", body: "Please fix this.", createdAt: 2 },
    { id: `${id}-a`, author: "agent", body: "Done.", createdAt: 3, fixed: true },
  ]);

describe("reviewStatus", () => {
  it("says a git commit is waiting on the review, what each button does, and until when", () => {
    expect(reviewStatus({ caller: { kind: "commit", waiting: true, until: 5000 }, annotations: [] })).toEqual([
      {
        tone: "waiting-on-you",
        text: "A git commit is waiting on this review. Approve to let it through, or Request Changes to stop it.",
        until: 5000,
      },
    ]);
  });

  it("says a commit that stopped waiting still gets the decision when it runs again", () => {
    const [line] = reviewStatus({ caller: { kind: "commit", waiting: false }, annotations: [] });
    expect(line).toMatchObject({ tone: "stale" });
    expect(line.text).toContain("stopped waiting");
    expect(line.text).toContain("run git commit again");
  });

  it("while findings are with the agent, says so, and that there's no need to request changes (#274)", () => {
    // The commit's wait ends on purpose when findings go out: no "stopped waiting" then.
    const lines = reviewStatus({ caller: { kind: "commit", waiting: false }, annotations: [sent("a"), sent("b"), fixed("c")] });
    expect(lines).toHaveLength(1);
    expect(lines[0].tone).toBe("waiting-on-agent");
    expect(lines[0].text).toContain("2 are with the agent, 1 fixed so far");
    expect(lines[0].text).toContain("No need to request changes");
  });

  it("once the agent is back, says what it fixed and that it's the reviewer's turn", () => {
    const lines = reviewStatus({ caller: { kind: "commit", waiting: true }, annotations: [fixed("a"), fixed("b")] });
    expect(lines.map((l) => l.text)).toEqual([
      "The agent is back: 2 fixed. Check the fixes, then decide.",
      "A git commit is waiting on this review. Approve to let it through, or Request Changes to stop it.",
    ]);
  });

  it("says what was decided, and nothing else, once decided (#269)", () => {
    const lines = reviewStatus({ caller: { kind: "commit", waiting: false }, decision: "changes_requested", annotations: [sent("a")] });
    expect(lines).toEqual([{ tone: "decided", text: expect.stringContaining("You requested changes.") }]);
  });

  it("while the agent has work, doesn't also say a commit is waiting on you, even for the few seconds the caller still looks waiting", () => {
    const lines = reviewStatus({ caller: { kind: "commit", waiting: true }, annotations: [sent("a")] });
    expect(lines.map((l) => l.tone)).toEqual(["waiting-on-agent"]);
  });

  it("covers questions as well as findings: the agent fixes or answers", () => {
    const [line] = reviewStatus({ annotations: [sent("a")] });
    expect(line.text).toContain("It fixes each finding without committing and marks it Fixed, or answers.");
  });

  it("doesn't count fixes from before the last decision: those were already judged", () => {
    // fixed("old") replied at 3; decided at 10; nothing new since.
    expect(reviewStatus({ decidedAt: 10, annotations: [fixed("old")] })).toEqual([]);
    const fresh = thread("new", [
      { id: "r", author: "reviewer", body: "Please fix this.", createdAt: 11 },
      { id: "a", author: "agent", body: "Done.", createdAt: 12, fixed: true },
    ]);
    expect(reviewStatus({ decidedAt: 10, annotations: [fixed("old"), fresh] })[0].text).toBe(
      "The agent is back: 1 fixed. Check the fixes, then decide.",
    );
  });

  it("says nothing when nothing is waiting and nothing is out", () => {
    expect(reviewStatus({ annotations: [thread("a")] })).toEqual([]);
  });

  it("names other callers, and where the decision goes", () => {
    expect(reviewStatus({ caller: { kind: "agent", waiting: true }, annotations: [] })[0].text).toBe(
      "An agent is waiting on this review. Your decision goes back to it.",
    );
    expect(reviewStatus({ caller: { kind: "review", waiting: false }, annotations: [] })[0].text).toContain("run diffprism review again");
  });
});

describe("the status line", () => {
  const summary = (over: Partial<SessionSummary>): SessionSummary => ({
    id: "s1", projectPath: "/p", fileCount: 1, additions: 1, deletions: 0, status: "in_review", createdAt: 1, ...over,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("counts down the time a waiting commit has left", () => {
    useReviewStore.setState({ reviewId: "s1", annotations: [], sessions: [summary({ caller: { kind: "commit", waiting: true, until: 1_000_000 + 125_000 } })] });
    render(<ReviewStatus />);
    const status = screen.getByRole("status", { name: "Review status" });
    expect(status.textContent).toContain("A git commit is waiting on this review.");
    expect(status.textContent).toContain("It waits another 2:05.");
  });

  it("isn't there when there's nothing to say", () => {
    useReviewStore.setState({ reviewId: "s1", annotations: [], sessions: [summary({})] });
    render(<ReviewStatus />);
    expect(screen.queryByRole("status", { name: "Review status" })).toBeNull();
  });
});
