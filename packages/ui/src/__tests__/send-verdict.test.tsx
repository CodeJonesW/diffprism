/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, screen, cleanup, act } from "@testing-library/react";
import { useSendVerdict } from "../hooks/useSendVerdict";
import { ActionBar } from "../components/ActionBar";
import { useReviewStore } from "../store/review";

// A decision that silently fails to reach the server leaves whoever waits on
// it — an agent, a commit — blocked with no reason (#203).
describe("sending a decision", () => {
  const fetchMock = vi.fn();
  const approve = { decision: "approved" as const, comments: [] };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, "", "/?httpPort=2");
    useReviewStore.setState({ reviewId: "s1", verdict: { state: "idle" } });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("posts it to the server and counts it sent only once the server records it", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { result } = renderHook(() => useSendVerdict());

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current(approve);
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:2/api/reviews/s1/result",
      expect.objectContaining({ method: "POST", body: JSON.stringify(approve) }),
    );
    expect(useReviewStore.getState().verdict).toEqual({ state: "idle" });
  });

  it("is sending until the server answers", async () => {
    let answer!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useSendVerdict());

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current(approve);
    });
    expect(useReviewStore.getState().verdict).toEqual({ state: "sending", decision: "approved" });

    await act(async () => {
      answer({ ok: true, json: async () => ({ ok: true }) });
      await pending;
    });
    expect(useReviewStore.getState().verdict).toEqual({ state: "idle" });
  });

  it("says why when the server refuses it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "Session not found" }) });
    const { result } = renderHook(() => useSendVerdict());

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current(approve);
    });

    expect(sent).toBe(false);
    expect(useReviewStore.getState().verdict).toEqual({ state: "failed", decision: "approved", error: "Session not found" });
  });

  it("says so when the server can't be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useSendVerdict());

    await act(async () => {
      await result.current(approve);
    });

    expect(useReviewStore.getState().verdict).toMatchObject({ state: "failed", error: "Failed to connect to server" });
  });
});

describe("the action bar while a decision is on its way", () => {
  beforeEach(() => {
    useReviewStore.setState({ reviewId: "s1", diffSet: null, comments: [], draftComment: null, fileStatuses: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it("holds every decision while one is sending, and says which", () => {
    useReviewStore.setState({ verdict: { state: "sending", decision: "changes_requested" } });
    render(<ActionBar onSubmit={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Sending/ })).toBeDefined();
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("shows why a decision wasn't sent, and lets the reviewer choose again", () => {
    useReviewStore.setState({ verdict: { state: "failed", decision: "approved", error: "Session not found" } });
    const onSubmit = vi.fn();
    render(<ActionBar onSubmit={onSubmit} />);

    expect(screen.getByRole("alert").textContent).toContain("Session not found");
    screen.getByRole("button", { name: "Approve" }).click();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ decision: "approved" }));
  });
});
