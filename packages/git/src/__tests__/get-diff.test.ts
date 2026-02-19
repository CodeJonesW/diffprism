import { describe, it, expect, vi } from "vitest";

// Mock the local and parser modules before importing getDiff
vi.mock("../local.js", () => ({
  getGitDiff: vi.fn(),
}));

vi.mock("../parser.js", () => ({
  parseDiff: vi.fn(),
}));

import { getDiff } from "../index.js";
import { getGitDiff } from "../local.js";
import { parseDiff } from "../parser.js";

const mockGetGitDiff = vi.mocked(getGitDiff);
const mockParseDiff = vi.mocked(parseDiff);

const emptyDiffSet = { baseRef: "", headRef: "", files: [] };

describe("getDiff", () => {
  describe("ref label derivation", () => {
    it('derives baseRef="HEAD", headRef="staged" for ref "staged"', () => {
      mockGetGitDiff.mockReturnValue("raw diff");
      mockParseDiff.mockReturnValue(emptyDiffSet);

      getDiff("staged");

      expect(mockParseDiff).toHaveBeenCalledWith("raw diff", "HEAD", "staged");
    });

    it('derives baseRef="staged", headRef="working tree" for ref "unstaged"', () => {
      mockGetGitDiff.mockReturnValue("raw diff");
      mockParseDiff.mockReturnValue(emptyDiffSet);

      getDiff("unstaged");

      expect(mockParseDiff).toHaveBeenCalledWith(
        "raw diff",
        "staged",
        "working tree",
      );
    });

    it("splits ref ranges at .. for baseRef and headRef", () => {
      mockGetGitDiff.mockReturnValue("raw diff");
      mockParseDiff.mockReturnValue(emptyDiffSet);

      getDiff("main..feature");

      expect(mockParseDiff).toHaveBeenCalledWith(
        "raw diff",
        "main",
        "feature",
      );
    });

    it("handles three-dot range by splitting at first ..", () => {
      mockGetGitDiff.mockReturnValue("raw diff");
      mockParseDiff.mockReturnValue(emptyDiffSet);

      getDiff("HEAD~3..HEAD");

      expect(mockParseDiff).toHaveBeenCalledWith(
        "raw diff",
        "HEAD~3",
        "HEAD",
      );
    });

    it('uses ref as baseRef and "HEAD" as headRef for plain refs', () => {
      mockGetGitDiff.mockReturnValue("raw diff");
      mockParseDiff.mockReturnValue(emptyDiffSet);

      getDiff("abc123");

      expect(mockParseDiff).toHaveBeenCalledWith(
        "raw diff",
        "abc123",
        "HEAD",
      );
    });
  });

  describe("return value", () => {
    it("returns both rawDiff and diffSet", () => {
      const fakeDiffSet = {
        baseRef: "HEAD",
        headRef: "staged",
        files: [
          {
            path: "test.ts",
            status: "modified" as const,
            hunks: [],
            language: "typescript",
            binary: false,
            additions: 1,
            deletions: 0,
          },
        ],
      };
      mockGetGitDiff.mockReturnValue("the raw diff");
      mockParseDiff.mockReturnValue(fakeDiffSet);

      const result = getDiff("staged");

      expect(result.rawDiff).toBe("the raw diff");
      expect(result.diffSet).toBe(fakeDiffSet);
    });
  });

  describe("cwd passthrough", () => {
    it("forwards cwd option to getGitDiff", () => {
      mockGetGitDiff.mockReturnValue("");
      mockParseDiff.mockReturnValue(emptyDiffSet);

      getDiff("staged", { cwd: "/some/path" });

      expect(mockGetGitDiff).toHaveBeenCalledWith("staged", {
        cwd: "/some/path",
      });
    });
  });
});
