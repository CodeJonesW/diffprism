import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───

const mockEnsureServer = vi.fn();
const mockSubmitReviewToServer = vi.fn();
const mockIsServerAlive = vi.fn();
vi.mock("@diffprism/core", () => {
  class ReviewTimeoutError extends Error {
    readonly sessionId: string;
    readonly waitedMs: number;
    constructor(sessionId: string, waitedMs: number) {
      super(`Review ${sessionId} is still open`);
      this.sessionId = sessionId;
      this.waitedMs = waitedMs;
    }
  }
  return {
    ensureServer: (...args: unknown[]) => mockEnsureServer(...args),
    submitReviewToServer: (...args: unknown[]) => mockSubmitReviewToServer(...args),
    isServerAlive: (...args: unknown[]) => mockIsServerAlive(...args),
    ReviewTimeoutError,
  };
});

vi.mock("@diffprism/git", () => ({ getDiff: vi.fn() }));
vi.mock("@diffprism/analysis", () => ({ analyze: vi.fn() }));

const mockIsPrRef = vi.fn();
vi.mock("@diffprism/github", () => ({
  isPrRef: (...args: unknown[]) => mockIsPrRef(...args),
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

const serverInfo = { httpPort: 24680, wsPort: 24681, pid: 1234, startedAt: Date.now() };
const base = `http://localhost:${serverInfo.httpPort}`;

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

async function tool(name: string): Promise<Handler> {
  const { startMcpServer } = await import("../index.js");
  await startMcpServer();
  const call = mockToolFn.mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`tool not registered: ${name}`);
  return call[call.length - 1] as Handler;
}

function parse(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

/** A fetch stub answering by URL. Records every request it sees. */
function stubFetch(routes: Record<string, () => ReturnType<typeof json>>) {
  const mock = vi.fn(async (url: string, _init?: { method?: string; body?: string }) => {
    for (const [prefix, respond] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return respond();
    }
    return json({ error: `unrouted: ${url}` }, 404);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function summary(id: string, over: Record<string, unknown> = {}) {
  return { id, projectPath: "/work/app", title: `title-${id}`, status: "in_review", fileCount: 1, additions: 1, deletions: 0, createdAt: 1, ...over };
}

beforeEach(() => {
  mockToolFn.mockClear();
  mockConnect.mockClear();
  mockEnsureServer.mockReset().mockResolvedValue(serverInfo);
  mockSubmitReviewToServer.mockReset();
  mockIsServerAlive.mockReset().mockResolvedValue(serverInfo);
  mockIsPrRef.mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Registration ───

describe("tool surface", () => {
  it("registers exactly the tools setup grants permission to", async () => {
    // setup and teardown write permissions from MCP_TOOL_NAMES. If the server
    // registers a tool not in that list, every call to it prompts; if the list
    // names a tool the server lacks, setup grants permission to nothing.
    const { MCP_TOOL_NAMES } = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();

    const registered = mockToolFn.mock.calls.map((c) => c[0] as string).sort();
    expect(registered).toEqual([...MCP_TOOL_NAMES].sort());
  });

  it("no longer registers the three overlapping annotate tools", async () => {
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();

    const names = mockToolFn.mock.calls.map((c) => c[0]);
    expect(names).not.toContain("add_annotation");
    expect(names).not.toContain("add_review_comment");
    expect(names).not.toContain("flag_for_attention");
  });

  it("connects the stdio transport", async () => {
    const { startMcpServer } = await import("../index.js");
    await startMcpServer();
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});

// ─── open_review ───

describe("open_review", () => {
  it("blocks for a decision by default", async () => {
    const { DEFAULT_WAIT_MS } = await import("../index.js");
    mockSubmitReviewToServer.mockResolvedValue({ result: { decision: "approved", comments: [] }, sessionId: "s1" });

    const handler = await tool("open_review");
    await handler({ diff_ref: "staged" });

    expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
      serverInfo,
      "staged",
      expect.objectContaining({ timeoutMs: DEFAULT_WAIT_MS, diffRef: "staged", cwd: process.cwd() }),
    );
  });

  it("returns the reviewer's decision", async () => {
    mockSubmitReviewToServer.mockResolvedValue({
      result: { decision: "changes_requested", comments: [], summary: "what is this?" },
      sessionId: "s1",
    });

    const result = await (await tool("open_review"))({ diff_ref: "staged" });

    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({ decision: "changes_requested", summary: "what is this?" });
  });

  it("returns the session id at once with wait: false", async () => {
    mockSubmitReviewToServer.mockResolvedValue({ result: null, sessionId: "s1" });

    const result = await (await tool("open_review"))({ diff_ref: "staged", wait: false });

    expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
      serverInfo,
      "staged",
      expect.objectContaining({ timeoutMs: 0 }),
    );
    expect(parse(result)).toMatchObject({ status: "open", sessionId: "s1" });
  });

  it("honours a custom timeout", async () => {
    mockSubmitReviewToServer.mockResolvedValue({ result: { decision: "approved", comments: [] }, sessionId: "s1" });

    await (await tool("open_review"))({ diff_ref: "staged", timeout_ms: 5000 });

    expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
      serverInfo,
      "staged",
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it("hands back the session id when the wait runs out, instead of failing", async () => {
    const { ReviewTimeoutError } = await import("@diffprism/core");
    mockSubmitReviewToServer.mockRejectedValue(new ReviewTimeoutError("s-slow", 600_000));

    const result = await (await tool("open_review"))({ diff_ref: "staged" });

    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({ status: "timed_out", sessionId: "s-slow" });
  });

  it("refuses pull requests without opening anything", async () => {
    mockIsPrRef.mockReturnValue(true);

    const result = await (await tool("open_review"))({ diff_ref: "acme/app#99" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("diffprism review <PR URL>");
    expect(mockEnsureServer).not.toHaveBeenCalled();
    expect(mockSubmitReviewToServer).not.toHaveBeenCalled();
  });

  it("passes context through and defaults annotation lines to 1", async () => {
    mockSubmitReviewToServer.mockResolvedValue({ result: null, sessionId: "s1" });

    await (await tool("open_review"))({
      diff_ref: "working-copy",
      title: "T",
      description: "D",
      reasoning: "R",
      wait: false,
      annotations: [{ file: "a.ts", body: "note", type: "finding" }],
    });

    expect(mockSubmitReviewToServer).toHaveBeenCalledWith(
      serverInfo,
      "working-copy",
      expect.objectContaining({
        title: "T",
        description: "D",
        reasoning: "R",
        annotations: [expect.objectContaining({ file: "a.ts", line: 1 })],
      }),
    );
  });

  it("reports other failures as tool errors", async () => {
    mockEnsureServer.mockRejectedValue(new Error("boom"));
    const result = await (await tool("open_review"))({ diff_ref: "staged" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: boom");
  });
});

// ─── Session targeting ───

describe("session targeting", () => {
  it("uses session_id directly, without looking anything up", async () => {
    const fetchMock = stubFetch({ [`${base}/api/reviews/s-explicit/annotations`]: () => json({ annotationId: "a1" }) });

    await (await tool("annotate"))({
      session_id: "s-explicit",
      annotations: [{ file: "a.ts", body: "x", type: "finding" }],
    });

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("/resolve"))).toBe(false);
    expect(urls).toContain(`${base}/api/reviews/s-explicit/annotations`);
  });

  it("resolves repo_path through the server", async () => {
    const fetchMock = stubFetch({
      [`${base}/api/reviews/resolve`]: () => json({ repoRoot: "/other/repo", sessions: [summary("s-other")] }),
      [`${base}/api/reviews/s-other/annotations`]: () => json({ annotationId: "a1" }),
    });

    await (await tool("annotate"))({
      repo_path: "/other/repo/src",
      annotations: [{ file: "a.ts", body: "x", type: "finding" }],
    });

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain(`${base}/api/reviews/resolve?path=${encodeURIComponent("/other/repo/src")}`);
    expect(urls).toContain(`${base}/api/reviews/s-other/annotations`);
  });

  it("falls back to the directory the agent is running in", async () => {
    const fetchMock = stubFetch({
      [`${base}/api/reviews/resolve`]: () => json({ repoRoot: process.cwd(), sessions: [summary("s-here")] }),
      [`${base}/api/reviews/s-here/annotations`]: () => json({ annotations: [] }),
    });

    await (await tool("get_review_comments"))({});

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${base}/api/reviews/resolve?path=${encodeURIComponent(process.cwd())}`,
    );
  });

  it("errors when no review is open for the repo, rather than using another repo's", async () => {
    // The bug: this used to fall back to "the most recent session across all
    // repos", so an agent in one repo posted findings into another.
    const fetchMock = stubFetch({
      [`${base}/api/reviews/resolve`]: () => json({ repoRoot: "/work/app", sessions: [] }),
    });

    const result = await (await tool("annotate"))({
      annotations: [{ file: "a.ts", body: "x", type: "finding" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No review is open for /work/app");
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).endsWith("/annotations"))).toBe(false);
  });

  it("errors with the candidates when several reviews match, rather than picking one", async () => {
    const fetchMock = stubFetch({
      [`${base}/api/reviews/resolve`]: () =>
        json({
          repoRoot: "/work/widget",
          sessions: [summary("s-local", { diffRef: "working-copy" }), summary("s-pr", { title: "Add widget" })],
        }),
    });

    const result = await (await tool("annotate"))({
      annotations: [{ file: "a.ts", body: "x", type: "finding" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("s-local");
    expect(result.content[0].text).toContain("s-pr");
    expect(result.content[0].text).toContain("session_id");
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).endsWith("/annotations"))).toBe(false);
  });

  it("says so when no server is running", async () => {
    mockIsServerAlive.mockResolvedValue(null);
    const result = await (await tool("get_review_state"))({ session_id: "s1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No DiffPrism server is running");
  });
});

// ─── annotate ───

describe("annotate", () => {
  it("posts each finding with defaults filled in", async () => {
    const fetchMock = stubFetch({
      [`${base}/api/reviews/s1/annotations`]: () => json({ annotationId: "a" }),
    });

    const result = await (await tool("annotate"))({
      session_id: "s1",
      source_agent: "security-reviewer",
      annotations: [
        { file: "a.ts", line: 4, body: "injection", type: "warning", category: "security" },
        { file: "b.ts", body: "whole file", type: "question" },
      ],
    });

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1]?.body ?? "{}"));
    expect(bodies).toEqual([
      expect.objectContaining({ file: "a.ts", line: 4, type: "warning", category: "security", confidence: 1, source: { agent: "security-reviewer", tool: "annotate" } }),
      expect.objectContaining({ file: "b.ts", line: 1, type: "question", category: "other", confidence: 1 }),
    ]);
    expect(parse(result)).toMatchObject({ sessionId: "s1", annotationIds: ["a", "a"] });
  });

  it("reports partial failures instead of swallowing them", async () => {
    let n = 0;
    stubFetch({
      [`${base}/api/reviews/s1/annotations`]: () =>
        ++n === 1 ? json({ annotationId: "a1" }) : json({ error: "bad line" }, 400),
    });

    const result = await (await tool("annotate"))({
      session_id: "s1",
      annotations: [
        { file: "a.ts", body: "ok", type: "finding" },
        { file: "b.ts", line: 9, body: "rejected", type: "finding" },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({
      annotationIds: ["a1"],
      failed: [{ file: "b.ts", line: 9, error: "bad line" }],
    });
  });

  it("is an error when nothing was posted", async () => {
    stubFetch({ [`${base}/api/reviews/s1/annotations`]: () => json({ error: "gone" }, 404) });

    const result = await (await tool("annotate"))({
      session_id: "s1",
      annotations: [{ file: "a.ts", body: "x", type: "finding" }],
    });

    expect(result.isError).toBe(true);
  });
});

// ─── get_review_result ───

describe("get_review_result", () => {
  it("returns the decision once there is one", async () => {
    stubFetch({
      [`${base}/api/reviews/s1/result`]: () => json({ result: { decision: "approved", comments: [] } }),
    });

    const result = await (await tool("get_review_result"))({ session_id: "s1" });
    expect(parse(result)).toMatchObject({ decision: "approved" });
  });

  it("reports pending while the reviewer is still deciding", async () => {
    stubFetch({ [`${base}/api/reviews/s1/result`]: () => json({ result: null }) });

    const result = await (await tool("get_review_result"))({ session_id: "s1" });
    expect(parse(result)).toMatchObject({ status: "pending", sessionId: "s1" });
  });
});
