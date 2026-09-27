/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BriefingBar } from "../components/BriefingBar/BriefingBar";
import { useReviewStore } from "../store/review";
import type { ReviewBriefing, SessionSummary } from "../types";

const briefing: ReviewBriefing = {
  summary: "1 file changed (+140 -0)",
  triage: { critical: [], notable: [], mechanical: [] },
  impact: {
    affectedModules: [],
    affectedTests: [],
    publicApiChanges: false,
    breakingChanges: [],
    newDependencies: [],
  },
  verification: { testsPass: null, typeCheck: null, lintClean: null },
  fileStats: [],
};

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectPath: "/Users/me/dev/radius",
    branch: "main",
    fileCount: 1,
    additions: 140,
    deletions: 0,
    status: "in_review",
    createdAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  useReviewStore.setState({
    briefing,
    sessions: [],
    activeSessionId: null,
    metadata: undefined,
  } as never);
});

describe("BriefingBar — which review am I looking at", () => {
  it("says it's a pull request, and that the decision goes to GitHub (#254)", () => {
    // Read from the review's own metadata — what picks the PR decision bar —
    // so the badge agrees with the bar even before the session list catches up.
    const githubPr = {
      owner: "CodeJonesW", repo: "diffprism", number: 239, title: "t", author: "a",
      url: "https://github.com/CodeJonesW/diffprism/pull/239", baseBranch: "main", headBranch: "f", viewer: "r",
    };
    useReviewStore.setState({ sessions: [session()], activeSessionId: "session-1", reviewId: "session-1", metadata: { githubPr } } as never);
    render(<BriefingBar />);
    const row = screen.getByLabelText("Review kind");
    expect(row.textContent).toContain("Pull request #239");
    expect(row.textContent).toContain("Your decision goes to GitHub, as a review on CodeJonesW/diffprism#239.");
  });

  it("says it's a local change, and that the decision goes back to what's waiting (#254)", () => {
    useReviewStore.setState({
      sessions: [session({ diffRef: "staged", caller: { kind: "commit", waiting: true } })],
      activeSessionId: "session-1",
      reviewId: "session-1",
    } as never);
    render(<BriefingBar />);
    const row = screen.getByLabelText("Review kind");
    expect(row.textContent).toContain("Local · staged · commit gate");
    expect(row.textContent).toContain("go back to the git commit waiting on this review, not to GitHub");
  });

  it("names the checkout and branch of the active session", () => {
    useReviewStore.setState({
      sessions: [session()],
      activeSessionId: "session-1",
    } as never);

    render(<BriefingBar />);

    expect(screen.getByText("radius")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("distinguishes two sessions that differ only by worktree", () => {
    // The case this exists for: several reviews open at once, and nothing in
    // the header said which branch or checkout the diff on screen came from.
    useReviewStore.setState({
      sessions: [
        session({ id: "a", projectPath: "/r/.claude/worktrees/hook-test", branch: "worktree-hook-test" }),
        session({ id: "b", projectPath: "/r/.claude/worktrees/install-steps-306", branch: "worktree-install-steps-306" }),
      ],
      activeSessionId: "b",
    } as never);

    render(<BriefingBar />);

    expect(screen.getByText("install-steps-306")).toBeTruthy();
    expect(screen.getByText("worktree-install-steps-306")).toBeTruthy();
    expect(screen.queryByText("hook-test")).toBeNull();
  });

  it("leaves the metadata branch to RefSelector rather than printing it twice", () => {
    // RefSelector already renders metadata.currentBranch as a static badge
    // outside server mode. Duplicating it here put the branch on screen twice.
    useReviewStore.setState({
      sessions: [],
      activeSessionId: null,
      metadata: { currentBranch: "feature/x" },
    } as never);

    render(<BriefingBar />);

    // RefSelector still shows it — exactly once, which is the point.
    expect(screen.getAllByText("feature/x")).toHaveLength(1);
  });

  it("renders without a branch rather than breaking", () => {
    useReviewStore.setState({
      sessions: [session({ branch: undefined, projectPath: "" })],
      activeSessionId: "session-1",
    } as never);

    render(<BriefingBar />);

    expect(screen.getByText(briefing.summary)).toBeTruthy();
  });
});
