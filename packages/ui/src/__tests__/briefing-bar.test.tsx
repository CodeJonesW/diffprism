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
