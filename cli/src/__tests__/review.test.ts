import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @diffprism/core before importing the review command
const mockEnsureServer = vi.fn();
const mockSubmitReviewToServer = vi.fn();
vi.mock("@diffprism/core", () => ({
  ensureServer: (...args: unknown[]) => mockEnsureServer(...args),
  submitReviewToServer: (...args: unknown[]) =>
    mockSubmitReviewToServer(...args),
}));

// Mock @diffprism/github
const mockIsPrRef = vi.fn();
const mockResolveGitHubToken = vi.fn();
const mockParsePrRef = vi.fn();
const mockCreateGitHubClient = vi.fn();
const mockFetchPullRequest = vi.fn();
const mockFetchPullRequestDiff = vi.fn();
const mockNormalizePr = vi.fn();
const mockSubmitGitHubReview = vi.fn();
vi.mock("@diffprism/github", () => ({
  isPrRef: (...args: unknown[]) => mockIsPrRef(...args),
  resolveGitHubToken: (...args: unknown[]) => mockResolveGitHubToken(...args),
  parsePrRef: (...args: unknown[]) => mockParsePrRef(...args),
  createGitHubClient: (...args: unknown[]) => mockCreateGitHubClient(...args),
  fetchPullRequest: (...args: unknown[]) => mockFetchPullRequest(...args),
  fetchPullRequestDiff: (...args: unknown[]) => mockFetchPullRequestDiff(...args),
  normalizePr: (...args: unknown[]) => mockNormalizePr(...args),
  submitGitHubReview: (...args: unknown[]) => mockSubmitGitHubReview(...args),
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

  describe("PR detection routing", () => {
    it("routes to PR flow when isPrRef returns true", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockResolveGitHubToken.mockReturnValue("gh-token");
      mockParsePrRef.mockReturnValue({ owner: "acme", repo: "app", number: 42 });
      mockCreateGitHubClient.mockReturnValue("client");
      mockFetchPullRequest.mockResolvedValue({
        owner: "acme", repo: "app", number: 42,
        title: "Fix bug", author: "dev", url: "https://github.com/acme/app/pull/42",
        baseBranch: "main", headBranch: "fix-bug", body: null,
      });
      mockFetchPullRequestDiff.mockResolvedValue("diff --git a/file.ts b/file.ts\n");
      mockNormalizePr.mockReturnValue({
        payload: { diffSet: { files: [] }, rawDiff: "" },
        diffSet: { files: [{ additions: 5, deletions: 2 }] },
      });
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-pr",
      });

      await review("acme/app#42", {});

      expect(mockIsPrRef).toHaveBeenCalledWith("acme/app#42");
      expect(mockResolveGitHubToken).toHaveBeenCalled();
      expect(mockParsePrRef).toHaveBeenCalledWith("acme/app#42");
      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "PR #42",
        expect.objectContaining({
          injectedPayload: expect.any(Object),
          projectPath: "github:acme/app",
        }),
      );
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("exits 1 when GitHub token is missing", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockResolveGitHubToken.mockImplementation(() => {
        throw new Error("GITHUB_TOKEN not set");
      });

      await review("acme/app#42", {});

      expect(console.error).toHaveBeenCalledWith("Error: GITHUB_TOKEN not set");
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("handles empty PR diff", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockResolveGitHubToken.mockReturnValue("gh-token");
      mockParsePrRef.mockReturnValue({ owner: "acme", repo: "app", number: 1 });
      mockCreateGitHubClient.mockReturnValue("client");
      mockFetchPullRequest.mockResolvedValue({
        owner: "acme", repo: "app", number: 1,
        title: "Empty", author: "dev", url: "https://github.com/acme/app/pull/1",
        baseBranch: "main", headBranch: "empty", body: null,
      });
      mockFetchPullRequestDiff.mockResolvedValue("   ");

      await review("acme/app#1", {});

      expect(console.log).toHaveBeenCalledWith("PR has no changes to review.");
      expect(mockSubmitReviewToServer).not.toHaveBeenCalled();
    });

    it("does not route to PR flow for local refs", async () => {
      mockIsPrRef.mockReturnValue(false);
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-1",
      });

      await review("HEAD~3..HEAD", {});

      expect(mockResolveGitHubToken).not.toHaveBeenCalled();
      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "HEAD~3..HEAD",
        expect.objectContaining({ cwd: process.cwd() }),
      );
    });
  });
});
