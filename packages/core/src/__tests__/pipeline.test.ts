import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReviewResult, ReviewOptions, DiffSet, ReviewBriefing } from "../types.js";

// ─── Mocks ───

const mockGetDiff = vi.fn();
const mockGetCurrentBranch = vi.fn();
vi.mock("@diffprism/git", () => ({
  getDiff: (...args: unknown[]) => mockGetDiff(...args),
  getCurrentBranch: (...args: unknown[]) => mockGetCurrentBranch(...args),
}));

const mockAnalyze = vi.fn();
vi.mock("@diffprism/analysis", () => ({
  analyze: (...args: unknown[]) => mockAnalyze(...args),
}));

const mockCreateSession = vi.fn();
const mockUpdateSession = vi.fn();
vi.mock("../review-manager.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  updateSession: (...args: unknown[]) => mockUpdateSession(...args),
}));

const mockSendInit = vi.fn();
const mockStoreInitPayload = vi.fn();
const mockSendDiffUpdate = vi.fn();
const mockSendContextUpdate = vi.fn();
const mockSendDiffError = vi.fn();
const mockOnSubmit = vi.fn();
const mockWaitForResult = vi.fn();
const mockTriggerRefresh = vi.fn();
const mockBridgeClose = vi.fn();
vi.mock("../watch-bridge.js", () => ({
  createWatchBridge: () =>
    Promise.resolve({
      port: 9999,
      sendInit: mockSendInit,
      storeInitPayload: mockStoreInitPayload,
      sendDiffUpdate: mockSendDiffUpdate,
      sendContextUpdate: mockSendContextUpdate,
      sendDiffError: mockSendDiffError,
      onSubmit: mockOnSubmit,
      waitForResult: mockWaitForResult,
      triggerRefresh: mockTriggerRefresh,
      close: mockBridgeClose,
    }),
}));

const mockPollerStart = vi.fn();
const mockPollerStop = vi.fn();
const mockPollerSetDiffRef = vi.fn();
const mockPollerRefresh = vi.fn();
vi.mock("../diff-poller.js", () => ({
  createDiffPoller: () => ({
    start: mockPollerStart,
    stop: mockPollerStop,
    setDiffRef: mockPollerSetDiffRef,
    refresh: mockPollerRefresh,
  }),
}));

vi.mock("../watch-file.js", () => ({
  writeWatchFile: vi.fn(),
  removeWatchFile: vi.fn(),
}));

vi.mock("get-port", () => ({
  default: vi.fn().mockResolvedValue(9999),
}));

vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs.existsSync for resolveUiDist / resolveUiRoot
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
}));

// Mock http.createServer for static server
const mockServerListen = vi.fn((_port: number, cb: () => void) => cb());
const mockServerClose = vi.fn();
const mockServerOn = vi.fn();
vi.mock("node:http", () => ({
  default: {
    createServer: () => ({
      listen: mockServerListen,
      close: mockServerClose,
      on: mockServerOn,
    }),
  },
}));

// ─── Helpers ───

function makeDiffSet(fileCount = 1): DiffSet {
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

function makeBriefing(): ReviewBriefing {
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

function makeResult(): ReviewResult {
  return {
    decision: "approved",
    comments: [],
    summary: "Looks good",
  };
}

describe("pipeline – startReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentBranch.mockReturnValue("main");
    mockCreateSession.mockReturnValue({ id: "review-1-1" });
    // By default, resolveUiDist succeeds (published mode)
    mockExistsSync.mockReturnValue(true);
  });

  it("returns early with approved result when diff has no files", async () => {
    const emptyDiffSet: DiffSet = { baseRef: "HEAD", headRef: "staged", files: [] };
    mockGetDiff.mockReturnValue({ diffSet: emptyDiffSet, rawDiff: "" });

    const { startReview } = await import("../pipeline.js");

    const result = await startReview({ diffRef: "staged", silent: true });

    expect(result.decision).toBe("approved");
    expect(result.summary).toBe("No changes to review.");
    // Should NOT create WS bridge or open browser
    expect(mockSendInit).not.toHaveBeenCalled();
    expect(mockBridgeClose).not.toHaveBeenCalled();
  });

  it("orchestrates full review flow: getDiff → analyze → bridge → wait → cleanup", async () => {
    const diffSet = makeDiffSet();
    const briefing = makeBriefing();
    const reviewResult = makeResult();

    mockGetDiff.mockReturnValue({ diffSet, rawDiff: "diff --git a/file b/file" });
    mockAnalyze.mockReturnValue(briefing);
    mockWaitForResult.mockResolvedValue(reviewResult);

    const { startReview } = await import("../pipeline.js");

    const result = await startReview({
      diffRef: "staged",
      title: "Test review",
      description: "A test",
      reasoning: "Because tests",
      silent: true,
    });

    // Verify pipeline order
    expect(mockGetDiff).toHaveBeenCalledWith("staged", { cwd: undefined });
    expect(mockAnalyze).toHaveBeenCalledWith(diffSet);
    expect(mockCreateSession).toHaveBeenCalled();
    expect(mockUpdateSession).toHaveBeenCalledWith("review-1-1", { status: "in_progress" });
    expect(mockSendInit).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "review-1-1",
        diffSet,
        briefing,
        metadata: expect.objectContaining({ title: "Test review" }),
      }),
    );
    expect(mockWaitForResult).toHaveBeenCalled();
    expect(result).toEqual(reviewResult);

    // Cleanup
    expect(mockBridgeClose).toHaveBeenCalled();
    expect(mockUpdateSession).toHaveBeenCalledWith("review-1-1", {
      status: "completed",
      result: reviewResult,
    });
  });

  it("cleans up bridge and server even when waitForResult rejects", async () => {
    const diffSet = makeDiffSet();
    mockGetDiff.mockReturnValue({ diffSet, rawDiff: "diff content" });
    mockAnalyze.mockReturnValue(makeBriefing());
    mockWaitForResult.mockRejectedValue(new Error("Browser closed"));

    const { startReview } = await import("../pipeline.js");

    await expect(
      startReview({ diffRef: "staged", silent: true }),
    ).rejects.toThrow("Browser closed");

    // Bridge must be closed even on error
    expect(mockBridgeClose).toHaveBeenCalled();
  });

  it("passes cwd through to getDiff and getCurrentBranch", async () => {
    mockGetDiff.mockReturnValue({ diffSet: { baseRef: "HEAD", headRef: "staged", files: [] }, rawDiff: "" });

    const { startReview } = await import("../pipeline.js");

    await startReview({ diffRef: "HEAD~3..HEAD", cwd: "/some/repo", silent: true });

    expect(mockGetDiff).toHaveBeenCalledWith("HEAD~3..HEAD", { cwd: "/some/repo" });
    expect(mockGetCurrentBranch).toHaveBeenCalledWith({ cwd: "/some/repo" });
  });

  it("includes currentBranch in metadata", async () => {
    const diffSet = makeDiffSet();
    mockGetDiff.mockReturnValue({ diffSet, rawDiff: "diff" });
    mockAnalyze.mockReturnValue(makeBriefing());
    mockWaitForResult.mockResolvedValue(makeResult());
    mockGetCurrentBranch.mockReturnValue("feature/my-branch");

    const { startReview } = await import("../pipeline.js");

    await startReview({ diffRef: "staged", silent: true });

    expect(mockSendInit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ currentBranch: "feature/my-branch" }),
      }),
    );
  });
});
