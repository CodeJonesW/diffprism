/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, renderHook, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { useFocusedAnnotationScroll } from "../hooks/useFocusedAnnotationScroll";
import { AnnotationPanel } from "../components/AnnotationPanel/AnnotationPanel";
import { useReviewStore } from "../store/review";
import type { Annotation } from "../types";

const scrollIntoView = vi.fn();

function thread(id: string, line: number): Annotation {
  return {
    id, sessionId: "s1", file: "src/InstallSheet.tsx", line, side: "new", body: `explain ${line}`, type: "question",
    confidence: 1, category: "other", source: { agent: "reviewer" }, createdAt: line, author: "reviewer",
  };
}

function mountThread(id: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-annotation-id", id);
  el.scrollIntoView = scrollIntoView;
  document.body.appendChild(el);
  return el;
}

describe("going to a thread from the annotation panel (#184)", () => {
  beforeEach(() => {
    scrollIntoView.mockReset();
    useReviewStore.setState({ focusedAnnotationId: null });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("hands the panel's navigation the thread itself, not just its file", () => {
    const onNavigate = vi.fn();
    render(<AnnotationPanel annotations={[thread("a", 142), thread("b", 159)]} onDismiss={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText("explain 159"));

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "b", line: 159 }));
  });

  it("scrolls to a thread in the file already open, then clears the focus", () => {
    mountThread("a");
    const target = mountThread("b");
    renderHook(() => useFocusedAnnotationScroll("same file"));

    act(() => useReviewStore.getState().focusAnnotation("b"));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
    expect(useReviewStore.getState().focusedAnnotationId).toBeNull();
  });

  it("waits for a thread in another file to render before scrolling to it", () => {
    const { rerender } = renderHook(({ rendered }) => useFocusedAnnotationScroll(rendered), {
      initialProps: { rendered: "old file" },
    });

    act(() => useReviewStore.getState().focusAnnotation("b"));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(useReviewStore.getState().focusedAnnotationId).toBe("b");

    mountThread("b");
    rerender({ rendered: "new file" });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState().focusedAnnotationId).toBeNull();
  });

  it("scrolls again when the same thread is picked twice", () => {
    mountThread("b");
    renderHook(() => useFocusedAnnotationScroll("same file"));

    act(() => useReviewStore.getState().focusAnnotation("b"));
    act(() => useReviewStore.getState().focusAnnotation("b"));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
