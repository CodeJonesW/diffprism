import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───

const mockEnsureServer = vi.fn();
const mockSubmitReviewToServer = vi.fn();
const mockIsServerAlive = vi.fn();
vi.mock("@diffprism/core", () => ({
  ensureServer: (...args: unknown[]) => mockEnsureServer(...args),
  submitReviewToServer: (...args: unknown[]) => mockSubmitReviewToServer(...args),
  isServerAlive: (...args: unknown[]) => mockIsServerAlive(...args),
}));

const mockGetDiff = vi.fn();
vi.mock("@diffprism/git", () => ({
  getDiff: (...args: unknown[]) => mockGetDiff(...args),
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

// ─── Helpers ───

const defaultServerInfo = {
  httpPort: 24680,
  wsPort: 24681,
  pid: 1234,
  startedAt: Date.now(),
};

describe("mcp-server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: ensureServer succeeds
    mockEnsureServer.mockResolvedValue(defaultServerInfo);
    // Default: no server alive (for tools that check directly)
    mockIsServerAlive.mockResolvedValue(null);
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

    it("calls ensureServer and submitReviewToServer", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [], summary: "LGTM" },
        sessionId: "session-123",
      });

      const handler = await getToolHandler();
      await handler({ diff_ref: "staged" });

      expect(mockEnsureServer).toHaveBeenCalledWith({ silent: true });
      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "staged",
        expect.objectContaining({
          cwd: process.cwd(),
          diffRef: "staged",
        }),
      );
    });

    it("passes optional fields through to submitReviewToServer", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-123",
      });

      const handler = await getToolHandler();
      await handler({
        diff_ref: "HEAD~2..HEAD",
        title: "My Review",
        description: "Some changes",
        reasoning: "Because I said so",
      });

      expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
        defaultServerInfo,
        "HEAD~2..HEAD",
        expect.objectContaining({
          title: "My Review",
          description: "Some changes",
          reasoning: "Because I said so",
          diffRef: "HEAD~2..HEAD",
        }),
      );
    });

    it("returns ReviewResult as JSON text content", async () => {
      const reviewResult = {
        decision: "changes_requested",
        comments: [{ file: "a.ts", line: 1, body: "Fix this", type: "must_fix" }],
        summary: "Needs work",
      };
      mockSubmitReviewToServer.mockResolvedValue({
        result: reviewResult,
        sessionId: "session-123",
      });

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual(reviewResult);
      expect(result.isError).toBeUndefined();
    });

    it("returns error content when ensureServer throws", async () => {
      mockEnsureServer.mockRejectedValue(
        new Error("DiffPrism server failed to start within 15s"),
      );

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "Error: DiffPrism server failed to start within 15s",
      );
    });

    it("returns error content when submitReviewToServer throws", async () => {
      mockSubmitReviewToServer.mockRejectedValue(
        new Error("Global server returned 500 on create"),
      );

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "Error: Global server returned 500 on create",
      );
    });

    it("handles non-Error throws gracefully", async () => {
      mockSubmitReviewToServer.mockRejectedValue("string error");

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: string error");
    });

    it("stores sessionId for subsequent tool calls", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: { decision: "approved", comments: [] },
        sessionId: "session-456",
      });

      const handler = await getToolHandler();
      await handler({ diff_ref: "staged" });

      // The sessionId is stored in module state for update_review_context / get_review_result.
      // We verify by checking the handler was called successfully (state is internal).
      expect(mockSubmitReviewToServer).toHaveBeenCalled();
    });
  });
});
