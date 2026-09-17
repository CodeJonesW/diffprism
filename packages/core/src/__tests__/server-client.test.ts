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

import { ensureServer, submitReviewToServer, waitForDecision, ReviewerAskedError, ReviewTimeoutError } from "../server-client.js";
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

  const payload: ReviewInitPayload = {
    reviewId: "",
    diffSet: { files: [] } as never,
    rawDiff: "",
    briefing: {} as never,
    metadata: {},
  };

  /**
   * Answer by route, so a test says what the server holds rather than the
   * order of every request the wait happens to make.
   */
  function serve(routes: {
    results?: Array<unknown>;
    annotations?: Array<unknown[]>;
    createStatus?: number;
  }) {
    const results = [...(routes.results ?? [null])];
    const annotations = [...(routes.annotations ?? [[]])];
    mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.endsWith("/api/reviews") && init?.method === "POST") {
        const status = routes.createStatus ?? 200;
        return { ok: status < 400, status, json: async () => ({ sessionId: "s-1" }) };
      }
      if (url.endsWith("/annotations") && init?.method === "POST") {
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith("/result")) {
        const result = results.length > 1 ? results.shift() : results[0];
        return { ok: true, json: async () => ({ result }) };
      }
      if (url.endsWith("/annotations")) {
        const list = annotations.length > 1 ? annotations.shift() : annotations[0];
        return { ok: true, json: async () => ({ annotations: list }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it("returns the decision once the reviewer gives one", async () => {
    serve({ results: [{ decision: "approved", comments: [] }] });

    const { result, sessionId } = await submitReviewToServer(defaultServerInfo, "PR #1", { injectedPayload: payload });

    expect(sessionId).toBe("s-1");
    expect(result!.decision).toBe("approved");
  });

  it("throws when server returns non-OK on create", async () => {
    serve({ createStatus: 500 });

    await expect(
      submitReviewToServer(defaultServerInfo, "staged", { injectedPayload: payload }),
    ).rejects.toThrow("Global server returned 500 on create");
  });

  it("posts initial annotations when provided", async () => {
    serve({ results: [{ decision: "approved", comments: [] }] });

    await submitReviewToServer(defaultServerInfo, "staged", {
      injectedPayload: payload,
      annotations: [{ file: "a.ts", line: 10, body: "Looks good", type: "suggestion" as const }],
    });

    const annotationCall = mockFetch.mock.calls[1];
    expect(annotationCall[0]).toContain("/api/reviews/s-1/annotations");
    expect(annotationCall[1].method).toBe("POST");
  });
});

describe("waitForDecision", () => {
  const thread = (over: Record<string, unknown>) => ({
    id: "t1", sessionId: "s-1", file: "a.ts", line: 3, side: "new", body: "Why?", type: "question",
    confidence: 1, category: "other", source: { agent: "reviewer" }, createdAt: 1, author: "reviewer", replies: [], ...over,
  });

  function serve(results: unknown[], annotations: unknown[][]) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/result")) {
        const result = results.length > 1 ? results.shift() : results[0];
        return { ok: true, json: async () => ({ result }) };
      }
      if (url.endsWith("/annotations")) {
        const list = annotations.length > 1 ? annotations.shift() : annotations[0];
        return { ok: true, json: async () => ({ annotations: list }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it("keeps waiting until a decision arrives", async () => {
    serve([null, null, { decision: "changes_requested", comments: [] }], [[]]);

    const result = await waitForDecision(defaultServerInfo, "s-1", 10_000, 1);

    expect(result.decision).toBe("changes_requested");
  });

  it("ends the wait when the reviewer asks the agent something, with the threads to answer", async () => {
    const agentFinding = thread({ id: "f1", author: "agent" });
    const question = thread({ id: "q1" });
    serve([null], [[agentFinding], [agentFinding, question]]);

    const err = await waitForDecision(defaultServerInfo, "s-1", 10_000, 1).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ReviewerAskedError);
    expect((err as ReviewerAskedError).sessionId).toBe("s-1");
    expect((err as ReviewerAskedError).threads.map((t) => t.id)).toEqual(["q1"]);
  });

  it("treats the reviewer's reply to an agent finding as a question too", async () => {
    const replied = thread({ id: "f1", author: "agent", replies: [{ id: "r", author: "reviewer", body: "Why?", createdAt: 2 }] });
    serve([null], [[replied]]);

    await expect(waitForDecision(defaultServerInfo, "s-1", 10_000, 1)).rejects.toBeInstanceOf(ReviewerAskedError);
  });

  it("prefers a decision over an unanswered question", async () => {
    serve([{ decision: "approved", comments: [] }], [[thread({})]]);

    expect((await waitForDecision(defaultServerInfo, "s-1", 10_000, 1)).decision).toBe("approved");
  });

  it("times out with the session id when nothing happens", async () => {
    serve([null], [[]]);

    await expect(waitForDecision(defaultServerInfo, "s-1", 20, 1)).rejects.toBeInstanceOf(ReviewTimeoutError);
  });

  it("fails loudly when the session is gone", async () => {
    mockFetch.mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }));

    await expect(waitForDecision(defaultServerInfo, "s-1", 10_000, 1)).rejects.toThrow("Session not found: s-1");
  });
});
