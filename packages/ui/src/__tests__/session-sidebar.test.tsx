/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SessionSidebar } from "../components/SessionSidebar/SessionSidebar";
import type { SessionSummary } from "../types";

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    projectPath: "/work/app",
    title: "app",
    fileCount: 1,
    additions: 1,
    deletions: 0,
    status: "pending",
    createdAt: Date.now(),
    ...over,
  };
}

function renderSidebar(sessions: SessionSummary[]) {
  return render(
    <SessionSidebar sessions={sessions} activeSessionId={null} onSelect={vi.fn()} onClose={vi.fn()} />,
  );
}

afterEach(cleanup);

describe("SessionSidebar signals", () => {
  it("shows when a session has new changes", () => {
    // Only the unmounted SessionList used to render this, so the signal the
    // server already sent never reached the screen.
    renderSidebar([session({ hasNewChanges: true })]);
    expect(screen.getByLabelText("New changes")).toBeTruthy();
  });

  it("stays quiet when there are no new changes", () => {
    renderSidebar([session({ hasNewChanges: false })]);
    expect(screen.queryByLabelText("New changes")).toBeNull();
  });

  it("renders attention straight from the server's summary", () => {
    const { container } = renderSidebar([session({ needsAttention: true })]);
    expect(container.querySelector(".text-warning")).not.toBeNull();
  });
});
