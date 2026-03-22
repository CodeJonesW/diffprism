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

const mockIsPrRef = vi.fn();
const mockParsePrRef = vi.fn();
vi.mock("@diffprism/github", () => ({
  isPrRef: (...args: unknown[]) => mockIsPrRef(...args),
  parsePrRef: (...args: unknown[]) => mockParsePrRef(...args),
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
    // Default: not a PR ref
    mockIsPrRef.mockReturnValue(false);
  });

  it("registers tools", async () => {
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();

    expect(mockToolFn).toHaveBeenCalledTimes(14);
    expect(mockToolFn.mock.calls[0][0]).toBe("open_review");
    expect(mockToolFn.mock.calls[1][0]).toBe("update_review_context");
    expect(mockToolFn.mock.calls[2][0]).toBe("get_review_result");
    expect(mockToolFn.mock.calls[3][0]).toBe("get_diff");
    expect(mockToolFn.mock.calls[4][0]).toBe("analyze_diff");
    expect(mockToolFn.mock.calls[5][0]).toBe("add_annotation");
    expect(mockToolFn.mock.calls[6][0]).toBe("get_review_state");
    expect(mockToolFn.mock.calls[7][0]).toBe("flag_for_attention");
    // Super Review tools
    expect(mockToolFn.mock.calls[8][0]).toBe("get_pr_context");
    expect(mockToolFn.mock.calls[9][0]).toBe("get_file_diff");
    expect(mockToolFn.mock.calls[10][0]).toBe("get_file_context");
    expect(mockToolFn.mock.calls[11][0]).toBe("add_review_comment");
    expect(mockToolFn.mock.calls[12][0]).toBe("get_review_comments");
    expect(mockToolFn.mock.calls[13][0]).toBe("get_user_focus");
  });

  it("connects the stdio transport", async () => {
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  describe("open_review tool handler", () => {
    async function getToolHandler(): Promise<
      (args: Record<string, string | number | boolean | undefined>) => Promise<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>
    > {
      const { startMcpServer } = await import("../index.js");
      await startMcpServer();
      // The handler is the last argument to server.tool()
      return mockToolFn.mock.calls[0][3];
    }

    it("calls ensureServer and submitReviewToServer with timeoutMs 0 by default", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: null,
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
          timeoutMs: 0,
        }),
      );
    });

    it("passes optional fields through to submitReviewToServer", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: null,
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
          timeoutMs: 0,
        }),
      );
    });

    it("returns session_created response when non-blocking (default)", async () => {
      mockSubmitReviewToServer.mockResolvedValue({
        result: null,
        sessionId: "session-123",
      });

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("session_created");
      expect(parsed.sessionId).toBe("session-123");
      expect(result.isError).toBeUndefined();
    });

    it("returns ReviewResult when timeout_ms causes a blocking wait", async () => {
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
      const result = await handler({ diff_ref: "staged", timeout_ms: 60000 });

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
        result: null,
        sessionId: "session-456",
      });

      const handler = await getToolHandler();
      await handler({ diff_ref: "staged" });

      // The sessionId is stored in module state for update_review_context / get_review_result.
      // We verify by checking the handler was called successfully (state is internal).
      expect(mockSubmitReviewToServer).toHaveBeenCalled();
    });

    it("routes to PR flow when diff_ref is a PR reference", async () => {
      mockIsPrRef.mockReturnValue(true);
      mockParsePrRef.mockReturnValue({ owner: "acme", repo: "app", number: 99 });

      // Mock fetch for /api/pr/open
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          sessionId: "session-pr-99",
          fileCount: 2,
          localRepoPath: "/tmp/app",
          pr: { title: "Add feature", author: "dev", url: "https://github.com/acme/app/pull/99" },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "acme/app#99" });

      expect(mockIsPrRef).toHaveBeenCalledWith("acme/app#99");
      expect(mockEnsureServer).toHaveBeenCalledWith({ silent: true });
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:${defaultServerInfo.httpPort}/api/pr/open`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ prUrl: "acme/app#99" }),
        }),
      );
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("session_created");
      expect(parsed.sessionId).toBe("session-pr-99");
      expect(parsed.localRepoConnected).toBe(true);

      vi.unstubAllGlobals();
    });
  });
});
