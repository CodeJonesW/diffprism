import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @diffprism/core before importing the review command
const mockEnsureServer = vi.fn();
const mockSubmitReviewToServer = vi.fn();
vi.mock("@diffprism/core", () => ({
  ensureServer: (...args: unknown[]) => mockEnsureServer(...args),
  submitReviewToServer: (...args: unknown[]) =>
    mockSubmitReviewToServer(...args),
}));

import { review } from "../commands/review.js";

const defaultServerInfo = {
  httpPort: 24680,
  wsPort: 24681,
  pid: 1234,
  startedAt: Date.now(),
};

describe("review command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureServer.mockResolvedValue(defaultServerInfo);
    // Prevent actual process.exit
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("flag resolution", () => {
    it('resolves --staged flag to diffRef "staged"', async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review(undefined, { staged: true });

      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "staged",
        expect.objectContaining({ diffRef: "staged" }),
      );
    });

    it('resolves --unstaged flag to diffRef "unstaged"', async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review(undefined, { unstaged: true });

      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "unstaged",
        expect.objectContaining({ diffRef: "unstaged" }),
      );
    });

    it("resolves an explicit ref argument", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review("HEAD~3..HEAD", {});

      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "HEAD~3..HEAD",
        expect.objectContaining({ diffRef: "HEAD~3..HEAD" }),
      );
    });

    it('defaults to "working-copy" when no ref or flags are provided', async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review(undefined, {});

      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "working-copy",
        expect.objectContaining({ diffRef: "working-copy" }),
      );
    });

    it("--staged takes priority over a ref argument", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review("HEAD~1..HEAD", { staged: true });

      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "staged",
        expect.objectContaining({ diffRef: "staged" }),
      );
    });
  });

  describe("options passthrough", () => {
    it("passes title to submitReviewToServer and dev to ensureServer", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review(undefined, {
        staged: true,
        title: "My Review",
        dev: true,
      });

      expect(mockEnsureServer).toHaveBeenCalledWith({ dev: true });
      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "staged",
        expect.objectContaining({
          title: "My Review",
        }),
      );
    });
  });

  describe("output and exit", () => {
    it("prints JSON result and exits 0 on success", async () => {
      const result = {
        decision: "approved" as const,
        comments: [],
        summary: "LGTM",
      };
      mockSubmitReviewToServer.mockResolvedValue({
        result,
        sessionId: "session-1",
      });

      await review(undefined, { staged: true });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("prints error message and exits 1 on failure", async () => {
      mockEnsureServer.mockRejectedValue(new Error("git not found"));

      await review(undefined, { staged: true });

      expect(console.error).toHaveBeenCalledWith("Error: git not found");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
