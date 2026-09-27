/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { refLabel, reviewKind } from "../lib/review-kind";
import { ActionBar } from "../components/ActionBar";
import { RefSelector } from "../components/RefSelector";
import { useReviewStore } from "../store/review";
import type { SessionSummary } from "../types";

// #254: a pull request review and a local one say which they are, and who gets the decision.
// #250: a local review's summary goes back with the decision, not to GitHub.

describe("reviewKind", () => {
  it("names a pull request by number, and says its decision goes to GitHub", () => {
    expect(reviewKind({ pr: "CodeJonesW/diffprism#239" })).toEqual({
      kind: "pr",
      label: "Pull request #239",
      destination: "Your decision goes to GitHub, as a review on CodeJonesW/diffprism#239.",
    });
  });

  it("names a local review by what it reviews and where it came from", () => {
    expect(reviewKind({ diffRef: "staged", caller: { kind: "commit", waiting: true } }).label).toBe("Local · staged · commit gate");
    expect(reviewKind({ diffRef: "main..feature", caller: { kind: "agent", waiting: false } }).label).toBe(
      "Local · main..feature · open_review",
    );
    expect(reviewKind({ diffRef: "working-copy", source: "manual" }).label).toBe("Local · working copy · opened here");
    expect(reviewKind({}).label).toBe("Local · working copy");
  });

  it("says a local decision goes back to what's waiting, never to GitHub", () => {
    expect(reviewKind({ caller: { kind: "commit", waiting: true } }).destination).toBe(
      "Your decision and summary go back to the git commit waiting on this review, not to GitHub.",
    );
    expect(reviewKind({}).destination).toMatch(/Nothing goes to GitHub/);
  });

  it("reads a diff ref the way a reviewer would", () => {
    expect(refLabel("working-copy")).toBe("working copy");
    expect(refLabel(undefined)).toBe("working copy");
    expect(refLabel("staged")).toBe("staged");
    expect(refLabel("HEAD~3..HEAD")).toBe("HEAD~3..HEAD");
  });
});

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    projectPath: "/work/app",
    fileCount: 1,
    additions: 1,
    deletions: 0,
    status: "in_review",
    createdAt: Date.now(),
    ...over,
  };
}

describe("a local review's decision bar (#250)", () => {
  beforeEach(() => {
    useReviewStore.setState({
      reviewId: "s1",
      activeSessionId: "s1",
      sessions: [session({ diffRef: "staged", caller: { kind: "commit", waiting: true } })],
      diffSet: null,
      comments: [],
      draftComment: null,
      fileStatuses: {},
      verdict: { state: "idle" },
      compareRef: null,
    } as never);
  });
  afterEach(cleanup);

  it("says the summary goes back with the decision, not to GitHub", () => {
    render(<ActionBar onSubmit={() => {}} />);
    expect(screen.getByText("Your decision and summary go back to the git commit waiting on this review, not to GitHub.")).toBeDefined();
    // Neutral about who reads it: the line above names what's waiting.
    expect(screen.getByRole("textbox", { name: "Summary" }).getAttribute("placeholder")).toBe(
      "Summary, sent back with your decision — not posted to GitHub (optional)",
    );
  });
});

describe("the ref picker (#254)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/?httpPort=2");
    vi.stubGlobal("fetch", vi.fn());
    useReviewStore.setState({
      activeSessionId: "s1",
      sessions: [session({ diffRef: "staged" })],
      compareRef: null,
      metadata: undefined,
    } as never);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows what the session reviews, so the commit gate's reads staged, not working copy", () => {
    render(<RefSelector />);
    expect(screen.getByRole("button", { name: /staged/ })).toBeDefined();
    expect(screen.queryByText("working copy")).toBeNull();
  });
});
