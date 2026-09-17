/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useReviewStore } from "../store/review";

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  private listeners: Record<string, ((e?: unknown) => unknown)[]> = {};
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: (e?: unknown) => unknown) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  async emit(type: string) {
    for (const fn of this.listeners[type] ?? []) await fn();
  }
}

describe("dashboard reconnects to the server (#188)", () => {
  let pid: number;
  const reload = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    pid = 100;
    reload.mockReset();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pid }))));
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "?wsPort=1&httpPort=2&serverMode=true", reload },
    });
    useReviewStore.setState({ activeSessionId: "s1" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function connected(socket: FakeSocket) {
    await act(async () => {
      await socket.emit("open");
    });
  }

  it("reconnects after the connection drops", async () => {
    renderHook(() => useWebSocket());
    await connected(FakeSocket.all[0]);

    await act(async () => {
      await FakeSocket.all[0].emit("close");
      vi.advanceTimersByTime(1000);
    });

    expect(FakeSocket.all).toHaveLength(2);
  });

  it("reloads when it reconnects to a different server — its sessions are gone", async () => {
    renderHook(() => useWebSocket());
    await connected(FakeSocket.all[0]);

    pid = 200;
    await act(async () => {
      await FakeSocket.all[0].emit("close");
      vi.advanceTimersByTime(1000);
    });
    await connected(FakeSocket.all[1]);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("re-selects the session it was viewing when the same server is back", async () => {
    renderHook(() => useWebSocket());
    await connected(FakeSocket.all[0]);

    await act(async () => {
      await FakeSocket.all[0].emit("close");
      vi.advanceTimersByTime(1000);
    });
    await connected(FakeSocket.all[1]);

    expect(reload).not.toHaveBeenCalled();
    expect(FakeSocket.all[1].sent.map((m) => JSON.parse(m))).toEqual([
      { type: "session:select", payload: { sessionId: "s1" } },
    ]);
  });

  it("stops reconnecting once the dashboard is gone", async () => {
    const { unmount } = renderHook(() => useWebSocket());
    await connected(FakeSocket.all[0]);
    unmount();

    await act(async () => {
      await FakeSocket.all[0].emit("close");
      vi.advanceTimersByTime(5000);
    });

    expect(FakeSocket.all).toHaveLength(1);
  });
});
