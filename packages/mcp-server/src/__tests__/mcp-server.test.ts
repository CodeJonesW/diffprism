import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───

const mockStartReview = vi.fn();
const mockReadWatchFile = vi.fn();
const mockReadReviewResult = vi.fn();
const mockConsumeReviewResult = vi.fn();
const mockIsServerAlive = vi.fn();
vi.mock("@diffprism/core", () => ({
  startReview: (...args: unknown[]) => mockStartReview(...args),
  readWatchFile: (...args: unknown[]) => mockReadWatchFile(...args),
  readReviewResult: (...args: unknown[]) => mockReadReviewResult(...args),
  consumeReviewResult: (...args: unknown[]) => mockConsumeReviewResult(...args),
  isServerAlive: (...args: unknown[]) => mockIsServerAlive(...args),
}));

const mockGetDiff = vi.fn();
const mockGetCurrentBranch = vi.fn();
const mockDetectWorktree = vi.fn();
vi.mock("@diffprism/git", () => ({
  getDiff: (...args: unknown[]) => mockGetDiff(...args),
  getCurrentBranch: (...args: unknown[]) => mockGetCurrentBranch(...args),
  detectWorktree: (...args: unknown[]) => mockDetectWorktree(...args),
}));

const mockAnalyze = vi.fn();
vi.mock("@diffprism/analysis", () => ({
  analyze: (...args: unknown[]) => mockAnalyze(...args),
}));

const mockResolveGitHubToken = vi.fn();
const mockParsePrRef = vi.fn();
const mockCreateGitHubClient = vi.fn();
const mockFetchPullRequest = vi.fn();
const mockFetchPullRequestDiff = vi.fn();
const mockNormalizePr = vi.fn();
const mockSubmitGitHubReview = vi.fn();
vi.mock("@diffprism/github", () => ({
  resolveGitHubToken: (...args: unknown[]) => mockResolveGitHubToken(...args),
  parsePrRef: (...args: unknown[]) => mockParsePrRef(...args),
  createGitHubClient: (...args: unknown[]) => mockCreateGitHubClient(...args),
  fetchPullRequest: (...args: unknown[]) => mockFetchPullRequest(...args),
  fetchPullRequestDiff: (...args: unknown[]) => mockFetchPullRequestDiff(...args),
  normalizePr: (...args: unknown[]) => mockNormalizePr(...args),
  submitGitHubReview: (...args: unknown[]) => mockSubmitGitHubReview(...args),
}));

const mockToolFn = vi.fn();
const mockConnect = vi.fn();
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    tool: mockToolFn,
    connect: mockConnect,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

const mockExistsSync = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
}));

// ─── Helpers ───

function makeDiffSet(fileCount = 1) {
  return {
    baseRef: "HEAD",
    headRef: "staged",
    files: Array.from({ length: fileCount }, (_, i) => ({
      path: `src/file${i}.ts`,
      status: "modified" as const,
      hunks: [],
      language: "typescript",
      binary: false,
      additions: 5,
      deletions: 2,
    })),
  };
}

function makeBriefing() {
  return {
    summary: "1 file changed",
    triage: { critical: [], notable: [], mechanical: [] },
    impact: {
      affectedModules: [],
      affectedTests: [],
      publicApiChanges: false,
      breakingChanges: [],
      newDependencies: [],
    },
    verification: { testsPass: null, typeCheck: null, lintClean: null },
    fileStats: [],
  };
}

describe("mcp-server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no global server running
    mockIsServerAlive.mockResolvedValue(null);
    // Default: not in a worktree
    mockDetectWorktree.mockReturnValue({ isWorktree: false });
  });

  it("registers tools", async () => {
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();

    expect(mockToolFn).toHaveBeenCalledTimes(9);
    expect(mockToolFn.mock.calls[0][0]).toBe("open_review");
    expect(mockToolFn.mock.calls[1][0]).toBe("update_review_context");
    expect(mockToolFn.mock.calls[2][0]).toBe("get_review_result");
    expect(mockToolFn.mock.calls[3][0]).toBe("get_diff");
    expect(mockToolFn.mock.calls[4][0]).toBe("analyze_diff");
    expect(mockToolFn.mock.calls[5][0]).toBe("add_annotation");
    expect(mockToolFn.mock.calls[6][0]).toBe("get_review_state");
    expect(mockToolFn.mock.calls[7][0]).toBe("flag_for_attention");
    expect(mockToolFn.mock.calls[8][0]).toBe("review_pr");
  });

  it("connects the stdio transport", async () => {
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  describe("open_review tool handler", () => {
    async function getToolHandler(): Promise<
      (args: Record<string, string | undefined>) => Promise<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>
    > {
      const { startMcpServer } = await import("../index.js");
      await startMcpServer();
      // The handler is the last argument to server.tool()
      return mockToolFn.mock.calls[0][3];
    }

    it("falls back to startReview when no global server is running", async () => {
      mockExistsSync.mockReturnValue(false);
      mockIsServerAlive.mockResolvedValue(null);
      mockStartReview.mockResolvedValue({
        decision: "approved",
        comments: [],
        summary: "LGTM",
      });

      const handler = await getToolHandler();
      await handler({ diff_ref: "staged" });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({
          diffRef: "staged",
          silent: true,
        }),
      );
    });

    it("enables dev mode when inside diffprism workspace", async () => {
      mockExistsSync.mockReturnValue(true);
      mockIsServerAlive.mockResolvedValue(null);
      mockStartReview.mockResolvedValue({ decision: "approved", comments: [] });

      const handler = await getToolHandler();
      await handler({ diff_ref: "staged" });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ dev: true }),
      );
    });

    it("disables dev mode when outside diffprism workspace", async () => {
      mockExistsSync.mockReturnValue(false);
      mockIsServerAlive.mockResolvedValue(null);
      mockStartReview.mockResolvedValue({ decision: "approved", comments: [] });

      const handler = await getToolHandler();
      await handler({ diff_ref: "unstaged" });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ dev: false }),
      );
    });

    it("passes optional fields through to startReview", async () => {
      mockExistsSync.mockReturnValue(false);
      mockIsServerAlive.mockResolvedValue(null);
      mockStartReview.mockResolvedValue({ decision: "approved", comments: [] });

      const handler = await getToolHandler();
      await handler({
        diff_ref: "HEAD~2..HEAD",
        title: "My Review",
        description: "Some changes",
        reasoning: "Because I said so",
      });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({
          diffRef: "HEAD~2..HEAD",
          title: "My Review",
          description: "Some changes",
          reasoning: "Because I said so",
        }),
      );
    });

    it("returns ReviewResult as JSON text content", async () => {
      mockExistsSync.mockReturnValue(false);
      mockIsServerAlive.mockResolvedValue(null);
      const reviewResult = {
        decision: "changes_requested",
        comments: [{ file: "a.ts", line: 1, body: "Fix this", type: "must_fix" }],
        summary: "Needs work",
      };
      mockStartReview.mockResolvedValue(reviewResult);

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual(reviewResult);
      expect(result.isError).toBeUndefined();
    });

    it("returns error content when startReview throws", async () => {
      mockExistsSync.mockReturnValue(false);
      mockIsServerAlive.mockResolvedValue(null);
      mockStartReview.mockRejectedValue(new Error("No changes to review"));

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: No changes to review");
    });

    it("handles non-Error throws gracefully", async () => {
      mockExistsSync.mockReturnValue(false);
      mockIsServerAlive.mockResolvedValue(null);
      mockStartReview.mockRejectedValue("string error");

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: string error");
    });

    it("routes through global server when one is running", async () => {
      const serverInfo = { httpPort: 24680, wsPort: 24681, pid: 1234, startedAt: Date.now() };
      mockIsServerAlive.mockResolvedValue(serverInfo);

      const diffSet = makeDiffSet();
      mockGetDiff.mockReturnValue({ diffSet, rawDiff: "diff content" });
      mockGetCurrentBranch.mockReturnValue("feature/test");
      mockAnalyze.mockReturnValue(makeBriefing());

      // Mock fetch: first call creates session, second call returns result
      const originalFetch = globalThis.fetch;
      let fetchCallCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCallCount++;
        if (typeof url === "string" && url.includes("/api/reviews") && !url.includes("/result")) {
          // POST /api/reviews — create session
          return {
            ok: true,
            status: 201,
            json: async () => ({ sessionId: "session-test-123" }),
          };
        }
        if (typeof url === "string" && url.includes("/result")) {
          // GET /api/reviews/:id/result — return result on first poll
          return {
            ok: true,
            json: async () => ({
              result: { decision: "approved", comments: [], summary: "LGTM" },
              status: "submitted",
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      try {
        const handler = await getToolHandler();
        const result = await handler({
          diff_ref: "staged",
          title: "Test via global",
        });

        // Should NOT call startReview
        expect(mockStartReview).not.toHaveBeenCalled();

        // Should compute diff locally
        expect(mockGetDiff).toHaveBeenCalledWith("staged", { cwd: process.cwd() });
        expect(mockAnalyze).toHaveBeenCalledWith(diffSet);

        // Should return the result
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.decision).toBe("approved");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns early with approved result for empty diff via global server", async () => {
      const serverInfo = { httpPort: 24680, wsPort: 24681, pid: 1234, startedAt: Date.now() };
      mockIsServerAlive.mockResolvedValue(serverInfo);

      const emptyDiffSet = { baseRef: "HEAD", headRef: "staged", files: [] };
      mockGetDiff.mockReturnValue({ diffSet: emptyDiffSet, rawDiff: "" });
      mockGetCurrentBranch.mockReturnValue("main");

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      // Should NOT call startReview or fetch
      expect(mockStartReview).not.toHaveBeenCalled();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.decision).toBe("approved");
      expect(parsed.summary).toBe("No changes to review.");
    });
  });
});
