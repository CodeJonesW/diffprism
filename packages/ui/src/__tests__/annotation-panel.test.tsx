/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AnnotationPanel } from "../components/AnnotationPanel";
import type { Annotation } from "../types";

function annotation(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "a", sessionId: "s", file: "src/cache.ts", line: 4, side: "new", body: "x", type: "finding",
    confidence: 1, category: "security", source: { agent: "security-reviewer" }, createdAt: 1, ...over,
  };
}

afterEach(cleanup);

describe("AnnotationPanel with threads (#160)", () => {
  it("files the reviewer's own questions under Your comments, not as an agent", () => {
    // Found driving the real dashboard: a reviewer's question was listed under
    // "Agent Annotations", attributed to an agent called "reviewer".
    render(
      <AnnotationPanel
        annotations={[annotation({ id: "q", author: "reviewer", type: "question", category: "other", source: { agent: "reviewer" }, body: "Why lazy?" })]}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("Your comments")).toBeTruthy();
    expect(screen.queryByText("reviewer")).toBeNull();
    expect(screen.getByText(/Annotations & comments/)).toBeTruthy();
    expect(screen.queryByText(/Agent Annotations/)).toBeNull();
  });

  it("keeps the agent-only title when there are no reviewer threads", () => {
    render(<AnnotationPanel annotations={[annotation()]} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Agent Annotations/)).toBeTruthy();
    expect(screen.getByText("security-reviewer")).toBeTruthy();
  });

  it("shows which threads are still waiting and which have replies", () => {
    render(
      <AnnotationPanel
        annotations={[
          annotation({ id: "waiting", author: "reviewer", body: "Unanswered?" }),
          annotation({ id: "answered", author: "reviewer", body: "Answered?", replies: [{ id: "r", author: "agent", body: "yes", createdAt: 2 }] }),
        ]}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        agentReadAt={2}
      />,
    );
    expect(screen.getByText("Waiting for an agent")).toBeTruthy();
    expect(screen.getByText("1 reply")).toBeTruthy();
  });

  it("says when no agent has picked a question up", () => {
    render(
      <AnnotationPanel
        annotations={[annotation({ id: "unheard", author: "reviewer", body: "Anyone?" })]}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("No agent listening")).toBeTruthy();
    expect(screen.queryByText("Waiting for an agent")).toBeNull();
  });
});
