import { describe, it, expect } from "vitest";
import { watcherPollDelay, DEFAULT_WATCH_SCHEDULE } from "../watch-schedule.js";

describe("watcherPollDelay", () => {
  it("polls at full speed while someone is viewing, however quiet the repo", () => {
    expect(watcherPollDelay({ viewed: true, quietPolls: 0 })).toBe(2_000);
    expect(watcherPollDelay({ viewed: true, quietPolls: 50 })).toBe(2_000);
  });

  it("slows down as soon as nobody is viewing", () => {
    expect(watcherPollDelay({ viewed: false, quietPolls: 0 })).toBe(30_000);
  });

  it("backs off while the repo stays quiet", () => {
    const delays = [0, 1, 2, 3].map((quietPolls) => watcherPollDelay({ viewed: false, quietPolls }));
    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000]);
  });

  it("stops backing off at the ceiling", () => {
    expect(watcherPollDelay({ viewed: false, quietPolls: 4 })).toBe(DEFAULT_WATCH_SCHEDULE.unviewedMaxMs);
    // A repo quiet for days must not overflow to Infinity.
    expect(watcherPollDelay({ viewed: false, quietPolls: 100_000 })).toBe(DEFAULT_WATCH_SCHEDULE.unviewedMaxMs);
  });

  it("honours a custom schedule", () => {
    const schedule = { viewedMs: 10, unviewedMs: 100, unviewedMaxMs: 250 };
    expect(watcherPollDelay({ viewed: true, quietPolls: 3 }, schedule)).toBe(10);
    expect(watcherPollDelay({ viewed: false, quietPolls: 1 }, schedule)).toBe(200);
    expect(watcherPollDelay({ viewed: false, quietPolls: 2 }, schedule)).toBe(250);
  });
});
