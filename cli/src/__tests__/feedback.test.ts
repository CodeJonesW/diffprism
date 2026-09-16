import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpen = vi.fn();
vi.mock("open", () => ({ default: (...args: unknown[]) => mockOpen(...args) }));

const mockReadLastError = vi.fn();
vi.mock("@diffprism/core", async () => {
  const actual = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
  return {
    buildFeedbackUrl: actual.buildFeedbackUrl,
    readLastError: (...args: unknown[]) => mockReadLastError(...args),
  };
});

import { feedback } from "../commands/feedback.js";

let logged: string[];

beforeEach(() => {
  logged = [];
  mockOpen.mockReset().mockResolvedValue(undefined);
  mockReadLastError.mockReset().mockReturnValue(null);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

describe("diffprism feedback", () => {
  it("opens a prefilled issue and prints its URL", async () => {
    await feedback({ message: "hello" });

    expect(mockOpen).toHaveBeenCalledTimes(1);
    const url = mockOpen.mock.calls[0][0] as string;
    expect(url).toContain("/issues/new?");
    expect(new URL(url).searchParams.get("labels")).toBe("feedback");
    expect(logged.join("\n")).toContain(url);
  });

  it("only prints with --print", async () => {
    await feedback({ print: true });
    expect(mockOpen).not.toHaveBeenCalled();
    expect(logged.at(-1)).toContain("/issues/new?");
  });

  it("includes the last error in a bug report, and says so", async () => {
    mockReadLastError.mockReturnValue({ command: "review", message: "boom", at: "2026-09-16T00:00:00Z" });

    await feedback({ bug: true, print: true });

    const url = logged.at(-1) ?? "";
    expect(new URL(url).searchParams.get("body")).toContain("boom");
    expect(logged.join("\n")).toContain("Including the last error");
  });

  it("does not read the last error for plain feedback", async () => {
    await feedback({ print: true });
    expect(mockReadLastError).not.toHaveBeenCalled();
  });

  it("still leaves the URL on screen when no browser can be opened", async () => {
    mockOpen.mockRejectedValue(new Error("no display"));
    await expect(feedback({})).resolves.toBeUndefined();
    expect(logged.join("\n")).toContain("/issues/new?");
  });
});
