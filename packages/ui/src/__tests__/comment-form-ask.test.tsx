/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { InlineCommentForm } from "../components/InlineComment/InlineCommentForm";
import { useReviewStore } from "../store/review";

describe("InlineCommentForm — asking the agent now (#177)", () => {
  afterEach(() => {
    cleanup();
    useReviewStore.setState({ draftComment: null });
  });

  const type = (text: string) =>
    fireEvent.change(screen.getByPlaceholderText("Write a comment..."), { target: { value: text } });

  it("offers only saving when nothing can hold a thread", () => {
    render(<InlineCommentForm location={{ file: "a.ts", line: 3, side: "new" }} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Ask agent now" })).toBeNull();
  });

  it("asks instead of saving, then closes and clears the draft", async () => {
    const onAsk = vi.fn(async () => ({ ok: true }));
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<InlineCommentForm location={{ file: "a.ts", line: 3, side: "new" }} onSave={onSave} onAsk={onAsk} onCancel={onCancel} />);

    type("  Why a Map here?  ");
    fireEvent.click(screen.getByRole("button", { name: "Ask agent now" }));

    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(onAsk).toHaveBeenCalledWith("Why a Map here?");
    expect(onSave).not.toHaveBeenCalled();
    expect(useReviewStore.getState().draftComment).toBeNull();
  });

  it("keeps the question and says why when asking fails", async () => {
    const onCancel = vi.fn();
    render(
      <InlineCommentForm
        location={{ file: "a.ts", line: 3, side: "new" }}
        onSave={vi.fn()}
        onAsk={async () => ({ ok: false, error: "Session not found" })}
        onCancel={onCancel}
      />,
    );

    type("Why a Map here?");
    fireEvent.click(screen.getByRole("button", { name: "Ask agent now" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Session not found");
    expect((screen.getByPlaceholderText("Write a comment...") as HTMLTextAreaElement).value).toBe("Why a Map here?");
    expect(onCancel).not.toHaveBeenCalled();
  });
});
