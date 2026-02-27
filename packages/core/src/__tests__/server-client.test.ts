import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───

const mockIsServerAlive = vi.fn();
vi.mock("../server-file.js", () => ({
  isServerAlive: (...args: unknown[]) => mockIsServerAlive(...args),
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockOpenSync = vi.fn();
const mockCloseSync = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    openSync: (...args: unknown[]) => mockOpenSync(...args),
    closeSync: (...args: unknown[]) => mockCloseSync(...args),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { ensureServer, submitReviewToServer } from "../server-client.js";
import type { GlobalServerInfo, ReviewInitPayload } from "../types.js";

// ─── Helpers ───

const defaultServerInfo: GlobalServerInfo = {
  httpPort: 24680,
  wsPort: 24681,
  pid: 1234,
  startedAt: Date.now(),
};

function mockChildProcess() {
  return {
    unref: vi.fn(),
    on: vi.fn(),
    pid: 9999,
  };
}

describe("ensureServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(42);
    mockSpawn.mockReturnValue(mockChildProcess());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns existing server without spawning", async () => {
    mockIsServerAlive.mockResolvedValue(defaultServerInfo);

    const result = await ensureServer();

    expect(result).toEqual(defaultServerInfo);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("spawns daemon when server is not alive, then returns once alive", async () => {
    // First call: not alive. Second call (in poll loop): alive.
    mockIsServerAlive
      .mockResolvedValueOnce(null) // initial check
      .mockResolvedValueOnce(null) // first poll
      .mockResolvedValueOnce(defaultServerInfo); // second poll — ready

    const result = await ensureServer({
      spawnCommand: ["node", "test-server.js"],
    });

    expect(result).toEqual(defaultServerInfo);
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["test-server.js"],
      expect.objectContaining({ detached: true }),
    );
  });

  it("throws on timeout when server never starts", async () => {
    mockIsServerAlive.mockResolvedValue(null);

    await expect(
      ensureServer({ spawnCommand: ["node", "fake"], timeoutMs: 1000 }),
    ).rejects.toThrow("DiffPrism server failed to start within 1s");
  });

  it("creates log directory if it does not exist", async () => {
    mockIsServerAlive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(defaultServerInfo);
    mockExistsSync.mockReturnValue(false);

    await ensureServer({ spawnCommand: ["node", "test.js"] });

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".diffprism"),
      { recursive: true },
    );
  });
});

describe("submitReviewToServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early with approved result for injected empty payload", async () => {
    // Submit with injected payload that has files
    const payload: ReviewInitPayload = {
      reviewId: "",
      diffSet: { files: [] } as never,
      rawDiff: "",
      briefing: {} as never,
      metadata: {},
    };

    // POST returns sessionId, then result poll returns a result
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: "s-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { decision: "approved", comments: [] },
          status: "submitted",
        }),
      });

    const { result, sessionId } = await submitReviewToServer(
      defaultServerInfo,
      "PR #1",
      { injectedPayload: payload },
    );

    expect(sessionId).toBe("s-1");
    expect(result.decision).toBe("approved");
  });

  it("throws when server returns non-OK on create", async () => {
    const payload: ReviewInitPayload = {
      reviewId: "",
      diffSet: { files: [] } as never,
      rawDiff: "",
      briefing: {} as never,
      metadata: {},
    };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(
      submitReviewToServer(defaultServerInfo, "staged", {
        injectedPayload: payload,
      }),
    ).rejects.toThrow("Global server returned 500 on create");
  });

  it("posts initial annotations when provided", async () => {
    const payload: ReviewInitPayload = {
      reviewId: "",
      diffSet: { files: [] } as never,
      rawDiff: "",
      briefing: {} as never,
      metadata: {},
    };

    mockFetch
      // POST /api/reviews
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: "s-2" }),
      })
      // POST annotation
      .mockResolvedValueOnce({ ok: true })
      // GET result poll — immediate result
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { decision: "approved", comments: [] },
          status: "submitted",
        }),
      });

    await submitReviewToServer(defaultServerInfo, "staged", {
      injectedPayload: payload,
      annotations: [
        {
          file: "a.ts",
          line: 10,
          body: "Looks good",
          type: "suggestion" as const,
        },
      ],
    });

    // Second fetch call should be the annotation POST
    const annotationCall = mockFetch.mock.calls[1];
    expect(annotationCall[0]).toContain("/api/reviews/s-2/annotations");
    expect(annotationCall[1].method).toBe("POST");
  });

  it("polls until result is available", async () => {
    const payload: ReviewInitPayload = {
      reviewId: "",
      diffSet: { files: [] } as never,
      rawDiff: "",
      briefing: {} as never,
      metadata: {},
    };

    mockFetch
      // POST /api/reviews
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: "s-3" }),
      })
      // First poll — no result
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, status: "pending" }),
      })
      // Second poll — still no result
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, status: "pending" }),
      })
      // Third poll — result available
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            decision: "changes_requested",
            comments: [
              { file: "b.ts", line: 5, body: "Fix this", type: "must_fix" },
            ],
          },
          status: "submitted",
        }),
      });

    const { result } = await submitReviewToServer(
      defaultServerInfo,
      "staged",
      { injectedPayload: payload },
    );

    expect(result.decision).toBe("changes_requested");
    expect(result.comments).toHaveLength(1);
    // 1 create + 3 polls = 4 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
