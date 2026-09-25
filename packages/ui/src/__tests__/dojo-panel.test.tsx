/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, renderHook, act } from "@testing-library/react";
import { DojoPanel } from "../components/DojoPanel";
import { useWebSocket } from "../hooks/useWebSocket";
import { useReviewStore } from "../store/review";
import type { DojoCombinedFinding, DojoState } from "../types";

const finding = (over: Partial<DojoCombinedFinding>): DojoCombinedFinding => ({
  id: "claude-1",
  raisedBy: "claude",
  file: "src/cache.ts",
  line: 12,
  side: "new",
  severity: "major",
  title: "Cache never expires",
  body: "No TTL.",
  votes: [],
  consensus: "agreed",
  annotationId: "ann-1",
  ...over,
});

const done: DojoState = {
  status: "done",
  startedAt: 1,
  finishedAt: 2,
  agents: [
    { agent: { name: "claude" }, label: "Claude Code" },
    { agent: { name: "cursor", model: "gpt-5" }, label: "Cursor", error: "couldn't vote: didn't answer with a JSON block." },
  ],
  findings: [
    finding({ votes: [{ agent: "cursor", stance: "agree", severity: "critical", note: "and it grows forever" }] }),
    finding({
      id: "cursor-1",
      raisedBy: "cursor",
      title: "Retry loop has no cap",
      consensus: "disputed",
      votes: [{ agent: "claude", stance: "disagree", severity: "nit", note: "bounded by the caller" }],
      annotationId: "ann-2",
    }),
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.pushState({}, "", "/?httpPort=24680");
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/dojo/agents")) {
      return new Response(JSON.stringify({ agents: [{ name: "claude", label: "Claude Code" }, { name: "cursor", label: "Cursor", model: "gpt-5" }] }));
    }
    if (url.endsWith("/dojo") && init?.method === "POST") return new Response("{}", { status: 202 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DojoPanel (#231)", () => {
  it("offers the installed agents, all chosen, and starts the dojo with the ones left ticked", async () => {
    render(<DojoPanel sessionId="s1" dojo={null} onNavigate={() => {}} onHide={() => {}} />);

    const cursor = (await screen.findByRole("checkbox", { name: /Cursor/ })) as HTMLInputElement;
    expect((screen.getByRole("checkbox", { name: /Claude Code/ }) as HTMLInputElement).checked).toBe(true);
    expect(cursor.checked).toBe(true);
    expect(screen.getByText("gpt-5")).toBeTruthy();

    fireEvent.click(cursor);
    fireEvent.click(screen.getByRole("button", { name: /Start the dojo/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:24680/api/reviews/s1/dojo",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ agents: ["claude"] }) }),
      ),
    );
  });

  it("shows findings by agreement, with who raised each and how the others voted", () => {
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} />);

    const agreed = screen.getByRole("region", { name: "Agreed" });
    expect(within(agreed).getByText("Cache never expires")).toBeTruthy();
    expect(within(agreed).getByText("Raised by Claude Code")).toBeTruthy();
    expect(agreed.textContent).toContain("Cursor agrees (critical): and it grows forever");

    const disputed = screen.getByRole("region", { name: "Disputed" });
    expect(disputed.textContent).toContain("Claude Code disagrees (nit): bounded by the caller");
    expect(screen.queryByRole("region", { name: "One reviewer" })).toBeNull();
  });

  it("says which agent dropped out, and why", () => {
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByText(/Cursor couldn't vote: didn't answer with a JSON block/)).toBeTruthy();
  });

  it("goes to a finding's thread when it's clicked", () => {
    const onNavigate = vi.fn();
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={onNavigate} onHide={() => {}} />);
    fireEvent.click(screen.getByText("Retry loop has no cap"));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "cursor-1", annotationId: "ann-2" }));
  });

  it("says why a dojo failed, and offers to run it again", async () => {
    const failed: DojoState = { status: "failed", startedAt: 1, agents: [], findings: [], error: "No agent could review." };
    render(<DojoPanel sessionId="s1" dojo={failed} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByText("The last dojo failed: No agent could review.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Start the dojo/ })).toBeTruthy();
  });

  it("shows a dojo in progress", () => {
    render(<DojoPanel sessionId="s1" dojo={{ status: "running", startedAt: 1, agents: [], findings: [] }} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByText(/reviewing, then voting/)).toBeTruthy();
  });
});

describe("dojo:update", () => {
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

  it("puts the dojo in the store, and a new review starts without one", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    window.history.replaceState(null, "", "/?wsPort=1&httpPort=2&serverMode=true");
    renderHook(() => useWebSocket());

    act(() => FakeSocket.last.emit("message", { type: "dojo:update", payload: done }));
    expect(useReviewStore.getState().dojo).toEqual(done);

    act(() =>
      FakeSocket.last.emit("message", {
        type: "review:init",
        payload: { reviewId: "s2", diffSet: { baseRef: "a", headRef: "b", files: [] }, rawDiff: "", briefing: null, metadata: {} },
      }),
    );
    expect(useReviewStore.getState().dojo).toBeNull();
  });
});
