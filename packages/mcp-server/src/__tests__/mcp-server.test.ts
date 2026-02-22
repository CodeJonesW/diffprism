import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───

const mockStartReview = vi.fn();
const mockReadWatchFile = vi.fn();
const mockReadReviewResult = vi.fn();
const mockConsumeReviewResult = vi.fn();
vi.mock("@diffprism/core", () => ({
  startReview: (...args: unknown[]) => mockStartReview(...args),
  readWatchFile: (...args: unknown[]) => mockReadWatchFile(...args),
  readReviewResult: (...args: unknown[]) => mockReadReviewResult(...args),
  consumeReviewResult: (...args: unknown[]) => mockConsumeReviewResult(...args),
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

describe("mcp-server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers tools", async () => {
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();

    expect(mockToolFn).toHaveBeenCalledTimes(3);
    expect(mockToolFn.mock.calls[0][0]).toBe("open_review");
    expect(mockToolFn.mock.calls[1][0]).toBe("update_review_context");
    expect(mockToolFn.mock.calls[2][0]).toBe("get_review_result");
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

    it("calls startReview with silent: true", async () => {
      mockExistsSync.mockReturnValue(false);
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
      mockExistsSync.mockReturnValue(true); // App.tsx exists → dev mode
      mockStartReview.mockResolvedValue({ decision: "approved", comments: [] });

      const handler = await getToolHandler();
      await handler({ diff_ref: "staged" });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ dev: true }),
      );
    });

    it("disables dev mode when outside diffprism workspace", async () => {
      mockExistsSync.mockReturnValue(false);
      mockStartReview.mockResolvedValue({ decision: "approved", comments: [] });

      const handler = await getToolHandler();
      await handler({ diff_ref: "unstaged" });

      expect(mockStartReview).toHaveBeenCalledWith(
        expect.objectContaining({ dev: false }),
      );
    });

    it("passes optional fields through to startReview", async () => {
      mockExistsSync.mockReturnValue(false);
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
      mockStartReview.mockRejectedValue(new Error("No changes to review"));

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: No changes to review");
    });

    it("handles non-Error throws gracefully", async () => {
      mockExistsSync.mockReturnValue(false);
      mockStartReview.mockRejectedValue("string error");

      const handler = await getToolHandler();
      const result = await handler({ diff_ref: "staged" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: string error");
    });
  });
});
