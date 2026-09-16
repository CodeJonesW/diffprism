/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useReviewStore } from "../store/review";
import type { Annotation } from "../types";

class FakeSocket {
  static last: FakeSocket;
  private listeners: Record<string, ((e: { data?: string }) => void)[]> = {};
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send() {}
  close() {}
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) });
  }
}

const annotation: Annotation = {
  id: "a1", sessionId: "s1", file: "a.ts", line: 1, side: "new", body: "Why?", type: "question",
  confidence: 1, category: "other", source: { agent: "reviewer" }, createdAt: 1,
};

describe("useWebSocket annotation:dismissed", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));

  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    window.history.replaceState(null, "", "/?wsPort=1&httpPort=2&serverMode=true");
    useReviewStore.setState({ reviewId: "s1", annotations: [annotation] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // The server broadcasts a dismissal after persisting it. Echoing it back as
  // a new dismiss request made every client re-POST on every broadcast — an
  // unbounded request loop.
  it("applies the server's dismissal without writing back to the server", () => {
    renderHook(() => useWebSocket());
    act(() => FakeSocket.last.emit("message", { type: "annotation:dismissed", payload: { annotationId: "a1" } }));

    expect(useReviewStore.getState().annotations[0].dismissed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
