import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @diffprism/core before importing the review command
const mockEnsureServer = vi.fn();
const mockSubmitReviewToServer = vi.fn();
const mockRecordError = vi.fn();
vi.mock("@diffprism/core", async () => {
  // Scope constants come from the real module so these tests assert against
  // the actual default, not a retyped copy of it.
  const actual = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
  return {
    ensureServer: (...args: unknown[]) => mockEnsureServer(...args),
    submitReviewToServer: (...args: unknown[]) =>
      mockSubmitReviewToServer(...args),
    DEFAULT_DIFF_REF: actual.DEFAULT_DIFF_REF,
    recordError: (...args: unknown[]) => mockRecordError(...args),
    REPORT_HINT: actual.REPORT_HINT,
  };
});

// Mock @diffprism/github
const mockIsPrRef = vi.fn();
const mockParsePrRef = vi.fn();
vi.mock("@diffprism/github", () => ({
  isPrRef: (...args: unknown[]) => mockIsPrRef(...args),
  parsePrRef: (...args: unknown[]) => mockParsePrRef(...args),
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
    // Default: not a PR ref (existing tests stay on local path)
    mockIsPrRef.mockReturnValue(false);
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
    it("passes title and reasoning to submitReviewToServer and dev to ensureServer", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review(undefined, {
        staged: true,
        title: "My Review",
        reasoning: "Why it changed",
        dev: true,
      });

      expect(mockEnsureServer).toHaveBeenCalledWith({ dev: true });
      // --reasoning used to be accepted and then dropped (#198).
      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "staged",
        expect.objectContaining({
          title: "My Review",
          reasoning: "Why it changed",
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

    it("keeps the error for a bug report and says how to file one (#159)", async () => {
      mockEnsureServer.mockRejectedValue(new Error("git not found"));

      await review(undefined, { staged: true });

      expect(mockRecordError).toHaveBeenCalledWith("review", expect.objectContaining({ message: "git not found" }));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("diffprism feedback --bug"));
    });
  });

  describe("PR detection routing", () => {
    it("routes to PR flow when isPrRef returns true", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockParsePrRef.mockReturnValue({ owner: "acme", repo: "app", number: 42 });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          sessionId: "session-pr-42",
          fileCount: 1,
          localRepoPath: "/tmp/app",
          pr: { title: "Fix bug", author: "dev", url: "https://github.com/acme/app/pull/42", baseBranch: "main", headBranch: "fix-bug" },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await review("acme/app#42", {});

      expect(mockIsPrRef).toHaveBeenCalledWith("acme/app#42");
      expect(mockParsePrRef).toHaveBeenCalledWith("acme/app#42");
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:${defaultServerInfo.httpPort}/api/pr/open`,
        expect.objectContaining({ method: "POST" }),
      );
      // It says where it ran, so the server reads the PR from this clone (#197).
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ prUrl: "acme/app#42", cwd: process.cwd() });

      vi.unstubAllGlobals();
    });

    it("sends --title and --reasoning with a PR, and names no tools that may not exist (#198)", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockParsePrRef.mockReturnValue({ owner: "acme", repo: "app", number: 42 });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionId: "session-pr-42", fileCount: 1, localRepoPath: null, pr: { title: "Fix bug" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await review("acme/app#42", { title: "Cache fix", reasoning: "Stale reads after deploy" });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        prUrl: "acme/app#42",
        title: "Cache fix",
        reasoning: "Stale reads after deploy",
      });
      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).not.toContain("add_review_comment");
      expect(printed).toContain("/review");

      vi.unstubAllGlobals();
    });

    it("exits 1 when server returns error", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockParsePrRef.mockReturnValue({ owner: "acme", repo: "app", number: 42 });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "GitHub token not found" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await review("acme/app#42", {});

      expect(console.error).toHaveBeenCalledWith("Error: GitHub token not found");
      expect(process.exit).toHaveBeenCalledWith(1);

      vi.unstubAllGlobals();
    });

    it("handles server connection failure", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockParsePrRef.mockReturnValue({ owner: "acme", repo: "app", number: 1 });

      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
      vi.stubGlobal("fetch", mockFetch);

      await review("acme/app#1", {});

      expect(console.error).toHaveBeenCalledWith("Error: Connection refused");
      expect(process.exit).toHaveBeenCalledWith(1);

      vi.unstubAllGlobals();
    });

    it("does not route to PR flow for local refs", async () => {
      mockIsPrRef.mockReturnValue(false);
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review("HEAD~3..HEAD", {});

      expect(mockParsePrRef).not.toHaveBeenCalled();
      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "HEAD~3..HEAD",
        expect.objectContaining({ cwd: process.cwd() }),
      );
    });
  });
});
