import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @diffprism/core before importing the review command
vi.mock("@diffprism/core", () => ({
  startReview: vi.fn(),
}));

import { review } from "../commands/review.js";
import { startReview } from "@diffprism/core";

const mockStartReview = vi.mocked(startReview);

describe("review command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent actual process.exit
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("flag resolution", () => {
    it('resolves --staged flag to diffRef "staged"', async () => {
      mockStartReview.mockResolvedValue({
        decision: "approved",
        comments: [],
      });

      await review(undefined, { staged: true });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ diffRef: "staged" }),
      );
    });

    it('resolves --unstaged flag to diffRef "unstaged"', async () => {
      mockStartReview.mockResolvedValue({
        decision: "approved",
        comments: [],
      });

      await review(undefined, { unstaged: true });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ diffRef: "unstaged" }),
      );
    });

    it("resolves an explicit ref argument", async () => {
      mockStartReview.mockResolvedValue({
        decision: "approved",
        comments: [],
      });

      await review("HEAD~3..HEAD", {});

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ diffRef: "HEAD~3..HEAD" }),
      );
    });

    it('defaults to "working-copy" when no ref or flags are provided', async () => {
      mockStartReview.mockResolvedValue({
        decision: "approved",
        comments: [],
      });

      await review(undefined, {});

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ diffRef: "working-copy" }),
      );
    });

    it("--staged takes priority over a ref argument", async () => {
      mockStartReview.mockResolvedValue({
        decision: "approved",
        comments: [],
      });

      await review("HEAD~1..HEAD", { staged: true });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ diffRef: "staged" }),
      );
    });
  });

  describe("options passthrough", () => {
    it("passes title and dev flag to startReview", async () => {
      mockStartReview.mockResolvedValue({
        decision: "approved",
        comments: [],
      });

      await review(undefined, {
        staged: true,
        title: "My Review",
        dev: true,
      });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "My Review",
          dev: true,
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
      mockStartReview.mockResolvedValue(result);

      await review(undefined, { staged: true });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("prints error message and exits 1 on failure", async () => {
      mockStartReview.mockRejectedValue(new Error("git not found"));

      await review(undefined, { staged: true });

      expect(console.error).toHaveBeenCalledWith("Error: git not found");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
