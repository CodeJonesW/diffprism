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

/** An agent is listening, on a review a fixer could work on, unless a test says otherwise. */
const status = (input: Omit<Parameters<typeof reviewStatus>[0], "listening" | "fixable"> & Partial<Parameters<typeof reviewStatus>[0]>) =>
  reviewStatus({ listening: true, fixable: true, ...input });

describe("reviewStatus", () => {
  it("says a git commit is waiting on the review, what each button does, and until when", () => {
    expect(status({ caller: { kind: "commit", waiting: true, until: 5000 }, annotations: [] })).toEqual([
      {
        tone: "waiting-on-you",
        text: "A git commit is waiting on this review. Approve to let it through, or Request Changes to stop it.",
        until: 5000,
      },
    ]);
  });

  it("says a commit that stopped waiting still gets the decision when it runs again", () => {
    const [line] = status({ caller: { kind: "commit", waiting: false }, annotations: [] });
    expect(line).toMatchObject({ tone: "stale" });
    expect(line.text).toContain("stopped waiting");
    expect(line.text).toContain("run git commit again");
  });

  it("while findings are with the agent, says so, and that there's no need to request changes (#274)", () => {
    // The commit's wait ends on purpose when findings go out: no "stopped waiting" then.
    const lines = status({ caller: { kind: "commit", waiting: false }, annotations: [sent("a"), sent("b"), fixed("c")] });
    expect(lines).toHaveLength(1);
    expect(lines[0].tone).toBe("waiting-on-agent");
    expect(lines[0].text).toContain("2 are with the agent, 1 fixed so far");
    expect(lines[0].text).toContain("No need to request changes");
  });

  it("once the agent is back, says what it fixed and that it's the reviewer's turn", () => {
    const lines = status({ caller: { kind: "commit", waiting: true }, annotations: [fixed("a"), fixed("b")] });
    expect(lines.map((l) => l.text)).toEqual([
      "The agent is back: 2 fixed. Check the fixes, then decide.",
      "A git commit is waiting on this review. Approve to let it through, or Request Changes to stop it.",
    ]);
  });

  it("says what was decided, and nothing else, once decided (#269)", () => {
    const lines = status({ caller: { kind: "commit", waiting: false }, decision: "changes_requested", annotations: [sent("a")] });
    expect(lines).toEqual([{ tone: "decided", text: expect.stringContaining("You requested changes.") }]);
  });

  it("while the agent has work, doesn't also say a commit is waiting on you, even for the few seconds the caller still looks waiting", () => {
    const lines = status({ caller: { kind: "commit", waiting: true }, annotations: [sent("a")] });
    expect(lines.map((l) => l.tone)).toEqual(["waiting-on-agent"]);
  });

  it("covers questions as well as findings: the agent fixes or answers", () => {
    const [line] = status({ annotations: [sent("a")] });
    expect(line.text).toContain("It fixes each finding without committing and marks it Fixed, or answers.");
  });

  it("doesn't count fixes from before the last decision: those were already judged", () => {
    // fixed("old") replied at 3; decided at 10; nothing new since.
    expect(status({ decidedAt: 10, annotations: [fixed("old")] })).toEqual([]);
    const fresh = thread("new", [
      { id: "r", author: "reviewer", body: "Please fix this.", createdAt: 11 },
      { id: "a", author: "agent", body: "Done.", createdAt: 12, fixed: true },
    ]);
    expect(status({ decidedAt: 10, annotations: [fixed("old"), fresh] })[0].text).toBe(
      "The agent is back: 1 fixed. Check the fixes, then decide.",
    );
  });

  it("says nothing when nothing is waiting and nothing is out", () => {
    expect(status({ annotations: [thread("a")] })).toEqual([]);
  });

  it("names other callers, and where the decision goes", () => {
    expect(status({ caller: { kind: "agent", waiting: true }, annotations: [] })[0].text).toBe(
      "An agent is waiting on this review. Your decision goes back to it.",
    );
    expect(status({ caller: { kind: "review", waiting: false }, annotations: [] })[0].text).toContain("run diffprism review again");
  });
});

// ─── #279: findings sent with nothing listening ───

describe("reviewStatus, with nothing listening (#279)", () => {
  it("says the commit stopped waiting, and offers to start an agent or to rerun the commit", () => {
    const lines = status({ caller: { kind: "commit", waiting: false }, annotations: [sent("a"), sent("b")], listening: false });
    expect(lines).toEqual([
      {
        tone: "stale",
        text: "2 are waiting for an agent, but the git commit that was waiting on this review stopped. Start an agent here to fix them, or ask yours to run git commit again.",
        action: "start-fixer",
      },
    ]);
  });

  it("says no agent is listening when nothing ever waited", () => {
    const [line] = status({ annotations: [sent("a")], listening: false });
    expect(line.text).toBe(
      "1 is waiting for an agent, but no agent is listening. Start an agent here to fix it, or ask the agent that made the change to answer your DiffPrism comments.",
    );
  });

  it("offers no agent to start where a fix wouldn't show, and says the step that still works", () => {
    const [line] = status({ caller: { kind: "review", waiting: false }, annotations: [sent("a")], listening: false, fixable: false });
    expect(line.text).toBe("1 is waiting for an agent, but `diffprism review` stopped waiting. To get it answered, run diffprism review again.");
    expect(line.action).toBeUndefined();
  });

  it("says the fixer it started is on them", () => {
    const [line] = status({
      annotations: [sent("a"), fixed("b")],
      listening: true,
      fixer: { label: "Claude Code", state: "running" },
    });
    expect(line).toEqual({
      tone: "waiting-on-agent",
      text: "Claude Code is fixing 1 finding, 1 fixed so far. It fixes each without committing and marks it Fixed, or answers. Wait for it, then decide.",
    });
  });

  it("offers no second agent once one is listening again, and drops a failure once nothing is left for it", () => {
    const failed = { label: "Cursor", state: "failed" as const, error: "It stopped." };
    // A git commit came back and has the finding: no button, just that the agent has it.
    const listening = status({ annotations: [sent("a")], listening: true, fixer: failed });
    expect(listening.map((l) => l.action)).toEqual([undefined, undefined]);
    expect(listening[1].text).toContain("1 is with the agent");
    // Nothing outstanding: the failure is history.
    expect(status({ annotations: [fixed("a")], listening: false, fixer: failed }).map((l) => l.tone)).toEqual(["waiting-on-you"]);
  });

  it("says why a fixer stopped, and offers to start one again while findings wait", () => {
    const lines = status({
      annotations: [sent("a")],
      listening: false,
      fixer: { label: "Cursor", state: "failed", error: "Cursor finished without replying to 1 thread." },
    });
    expect(lines).toEqual([
      { tone: "stale", text: "Cursor stopped fixing: Cursor finished without replying to 1 thread.", action: "start-fixer" },
    ]);
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

  it("starts an agent to fix findings nothing is listening for (#279)", async () => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/?httpPort=2");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ fixer: { label: "Claude Code", state: "running" } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    // Sent long ago, and no agent has read it since: nothing is listening.
    useReviewStore.setState({
      reviewId: "s1",
      metadata: undefined,
      annotations: [sent("a")],
      sessions: [summary({ diffRef: "staged", caller: { kind: "commit", waiting: false } })],
    } as never);
    render(<ReviewStatus />);

    expect(screen.getByRole("status", { name: "Review status" }).textContent).toContain("DiffPrism stages its fixes");
    screen.getByRole("button", { name: "Start an agent to fix these" }).click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("http://localhost:2/api/reviews/s1/fixer", expect.objectContaining({ method: "POST" })));
    vi.unstubAllGlobals();
  });

  it("offers no agent on a review of a commit range, where a fix wouldn't show", () => {
    useReviewStore.setState({
      reviewId: "s1",
      metadata: undefined,
      annotations: [sent("a")],
      sessions: [summary({ diffRef: "main..feature" })],
    } as never);
    render(<ReviewStatus />);
    expect(screen.queryByRole("button", { name: "Start an agent to fix these" })).toBeNull();
  });
});
