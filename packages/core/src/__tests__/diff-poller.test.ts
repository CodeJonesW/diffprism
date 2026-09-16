import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetDiff = vi.fn();
vi.mock("@diffprism/git", () => ({ getDiff: (...args: unknown[]) => mockGetDiff(...args) }));
vi.mock("@diffprism/analysis", () => ({ analyze: vi.fn(() => ({ summary: "x" })) }));

import { createDiffPoller } from "../diff-poller.js";

let current = "diff A";
function diff(raw: string) {
  return { diffSet: { baseRef: "HEAD", headRef: "working-copy", files: [] }, rawDiff: raw };
}

beforeEach(() => {
  vi.useFakeTimers();
  current = "diff A";
  mockGetDiff.mockReset().mockImplementation(() => diff(current));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDiffPoller", () => {
  it("still accepts a fixed interval", () => {
    const poller = createDiffPoller({ diffRef: "staged", cwd: "/r", pollInterval: 1000, onDiffChanged: vi.fn() });
    poller.start();
    const afterStart = mockGetDiff.mock.calls.length;

    vi.advanceTimersByTime(3000);
    expect(mockGetDiff.mock.calls.length - afterStart).toBe(3);
    poller.stop();
  });

  it("asks for the next interval before every poll, with the quiet-poll count", () => {
    const schedule = vi.fn(({ quietPolls }: { quietPolls: number }) => 100 * (quietPolls + 1));
    const poller = createDiffPoller({ diffRef: "staged", cwd: "/r", pollInterval: schedule, onDiffChanged: vi.fn() });
    poller.start();

    vi.advanceTimersByTime(100); // poll 1 — quiet
    vi.advanceTimersByTime(200); // poll 2 — quiet
    vi.advanceTimersByTime(300); // poll 3 — quiet

    expect(schedule.mock.calls.map((c) => c[0].quietPolls)).toEqual([0, 1, 2, 3]);
    poller.stop();
  });

  it("resets the quiet count when the diff changes", () => {
    const seen: number[] = [];
    const poller = createDiffPoller({
      diffRef: "staged",
      cwd: "/r",
      pollInterval: ({ quietPolls }) => {
        seen.push(quietPolls);
        return 100;
      },
      onDiffChanged: vi.fn(),
    });
    poller.start();

    vi.advanceTimersByTime(200); // two quiet polls
    current = "diff B";
    vi.advanceTimersByTime(100); // a change

    expect(seen.at(-1)).toBe(0);
    poller.stop();
  });

  it("counts a failing git call as quiet, so a broken repo backs off too", () => {
    const seen: number[] = [];
    const poller = createDiffPoller({
      diffRef: "staged",
      cwd: "/r",
      pollInterval: ({ quietPolls }) => {
        seen.push(quietPolls);
        return 100;
      },
      onDiffChanged: vi.fn(),
    });
    poller.start();
    mockGetDiff.mockImplementation(() => {
      throw new Error("index.lock exists");
    });

    vi.advanceTimersByTime(200);
    expect(seen.at(-1)).toBe(2);
    poller.stop();
  });

  it("wake polls immediately instead of waiting out a long back-off", () => {
    const onDiffChanged = vi.fn();
    const poller = createDiffPoller({ diffRef: "staged", cwd: "/r", pollInterval: 5 * 60_000, onDiffChanged });
    poller.start();

    current = "diff B";
    poller.wake();

    expect(onDiffChanged).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("wake restarts the schedule rather than adding a second timer", () => {
    const poller = createDiffPoller({ diffRef: "staged", cwd: "/r", pollInterval: 1000, onDiffChanged: vi.fn() });
    poller.start();
    const base = mockGetDiff.mock.calls.length;

    vi.advanceTimersByTime(500);
    poller.wake(); // +1
    vi.advanceTimersByTime(1000); // +1 — not +2

    expect(mockGetDiff.mock.calls.length - base).toBe(2);
    poller.stop();
  });

  it("does nothing after stop, including on wake", () => {
    const poller = createDiffPoller({ diffRef: "staged", cwd: "/r", pollInterval: 100, onDiffChanged: vi.fn() });
    poller.start();
    poller.stop();
    const base = mockGetDiff.mock.calls.length;

    poller.wake();
    vi.advanceTimersByTime(1000);
    expect(mockGetDiff.mock.calls.length).toBe(base);
  });
});
