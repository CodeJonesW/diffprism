/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { InlineAnnotationThread } from "../components/InlineComment";
import type { Annotation } from "../types";

function thread(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1", sessionId: "s1", file: "a.ts", line: 1, side: "new", body: "Why a Map here?", type: "question",
    confidence: 1, category: "other", source: { agent: "security-reviewer" }, createdAt: 1, ...over,
  };
}

afterEach(cleanup);

describe("InlineAnnotationThread", () => {
  it("still reads as an agent annotation when nobody has replied", () => {
    render(<InlineAnnotationThread annotations={[thread({ body: "Possible injection" })]} onDismiss={vi.fn()} />);
    expect(screen.getByText("Agent Annotation")).toBeTruthy();
    expect(screen.getByText("security-reviewer")).toBeTruthy();
  });

  it("shows the conversation with who said what", () => {
    render(
      <InlineAnnotationThread
        annotations={[
          thread({
            author: "reviewer",
            replies: [
              { id: "r1", author: "agent", agent: "pr-reviewer", body: "Constant-time lookup.", createdAt: 2 },
              { id: "r2", author: "reviewer", body: "Worth it for 3 items?", createdAt: 3 },
            ],
          }),
        ]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Discussion")).toBeTruthy();
    expect(screen.getAllByText("You")).toHaveLength(2);
    expect(screen.getByText("pr-reviewer")).toBeTruthy();
    expect(screen.getByText("Constant-time lookup.")).toBeTruthy();
    expect(screen.getByText("Worth it for 3 items?")).toBeTruthy();
  });

  it("says when it's waiting on an agent, and stops once one answers", () => {
    const { rerender } = render(
      <InlineAnnotationThread annotations={[thread({ author: "reviewer" })]} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText(/Waiting for the agent to reply/)).toBeTruthy();

    rerender(
      <InlineAnnotationThread
        annotations={[thread({ author: "reviewer", replies: [{ id: "r", author: "agent", body: "ok", createdAt: 2 }] })]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Waiting for the agent to reply/)).toBeNull();
  });

  it("posts a reply and closes the form", async () => {
    const onReply = vi.fn(async () => ({ ok: true }));
    render(<InlineAnnotationThread annotations={[thread()]} onDismiss={vi.fn()} onReply={onReply} />);

    fireEvent.click(screen.getByText("Reply"));
    fireEvent.change(screen.getByPlaceholderText("Reply…"), { target: { value: "Can you explain?" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    await waitFor(() => expect(onReply).toHaveBeenCalledWith("a1", "Can you explain?"));
    await waitFor(() => expect(screen.queryByPlaceholderText("Reply…")).toBeNull());
  });

  it("keeps what was written when a reply fails", async () => {
    const onReply = vi.fn(async () => ({ ok: false, error: "Failed to connect to server" }));
    render(<InlineAnnotationThread annotations={[thread()]} onDismiss={vi.fn()} onReply={onReply} />);

    fireEvent.click(screen.getByText("Reply"));
    const box = screen.getByPlaceholderText("Reply…") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "important thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    await waitFor(() => expect(screen.getByText("Failed to connect to server")).toBeTruthy());
    expect((screen.getByPlaceholderText("Reply…") as HTMLTextAreaElement).value).toBe("important thought");
  });

  it("offers no reply box without a server to post to", () => {
    render(<InlineAnnotationThread annotations={[thread()]} onDismiss={vi.fn()} />);
    expect(screen.queryByText("Reply")).toBeNull();
  });
});
