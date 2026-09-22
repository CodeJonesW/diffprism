import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as github from "@diffprism/github";
import open from "open";
import net from "node:net";
import type {
  GlobalServerHandle,
  ReviewInitPayload,
  ReviewBriefing,
  DiffSet,
  ReviewResult,
  ContextUpdatePayload,
  ServerMessage,
  SessionSummary,
  Annotation,
} from "../types.js";

// ─── Mocks ───

// Mock UI server — tests don't need a real UI
const mockServerListen = vi.fn((_port: number, cb: () => void) => cb());
const mockServerClose = vi.fn();
const mockServerOn = vi.fn();
vi.mock("../ui-server.js", () => ({
  resolveUiDist: () => "/fake/ui/dist",
  resolveUiRoot: () => "/fake/ui/root",
  startViteDevServer: vi.fn().mockResolvedValue({ close: vi.fn() }),
  createStaticServer: vi.fn().mockResolvedValue({
    listen: mockServerListen,
    close: mockServerClose,
    on: mockServerOn,
  }),
}));

// Mock open — don't open a browser during tests
vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock @diffprism/git — watcher uses getDiff
vi.mock("@diffprism/git", () => ({
  getDiff: vi.fn().mockReturnValue({
    diffSet: {
      baseRef: "HEAD",
      headRef: "working-copy",
      files: [],
    },
    rawDiff: "",
  }),
  getCurrentBranch: vi.fn().mockReturnValue("main"),
  // Test paths like "/test" are not repositories, so identity falls back to
  // the resolved path. Individual tests override this to model real repos.
  getRepoRoot: vi.fn().mockReturnValue(null),
  // POST /api/pr/open reads from a local clone when the server runs in one.
  // Pretend the process runs inside acme/widget. Passed as an implementation,
  // not via mockReturnValue: restoreAllMocks in afterEach wipes mockReturnValue
  // state but keeps a vi.fn(impl).
  getGitHubRemotes: vi.fn(() => ["acme/widget"]),
  listBranches: vi.fn().mockReturnValue({
    local: ["main", "feature-branch"],
    remote: ["origin/main", "origin/develop"],
  }),
  listCommits: vi.fn().mockReturnValue([
    {
      hash: "abc123full",
      shortHash: "abc123",
      subject: "Initial commit",
      author: "Test Author",
      date: "2025-01-15T10:30:00Z",
    },
  ]),
}));

// Mock @diffprism/github — POST /api/pr/open fetches the PR
vi.mock("@diffprism/github", () => ({
  isPrRef: vi.fn(() => true),
  parsePrRef: vi.fn(() => ({ owner: "acme", repo: "widget", number: 7 })),
  resolveGitHubToken: vi.fn(() => "test-token"),
  createGitHubClient: vi.fn(() => ({})),
  fetchPullRequest: vi.fn(async () => ({
    title: "Add widget",
    author: "someone",
    url: "https://github.com/acme/widget/pull/7",
    baseBranch: "main",
    headBranch: "feature",
  })),
  fetchPullRequestDiff: vi.fn(async () => ""),
  // A fresh payload per call: opening a session mutates it.
  normalizePr: vi.fn(() => {
    const diffSet = { baseRef: "main", headRef: "feature", files: [] };
    return {
      diffSet,
      payload: {
        reviewId: "",
        diffSet,
        rawDiff: "",
        briefing: {
          summary: "PR",
          triage: { critical: [], notable: [], mechanical: [] },
          impact: { affectedModules: [], affectedTests: [], publicApiChanges: false, breakingChanges: [], newDependencies: [] },
          verification: { testsPass: null, typeCheck: null, lintClean: null },
          fileStats: [],
        },
        metadata: {
          title: "Add widget",
          githubPr: {
            owner: "acme", repo: "widget", number: 7, title: "Add widget", author: "someone",
            url: "https://github.com/acme/widget/pull/7", baseBranch: "main", headBranch: "feature",
          },
        },
      },
    };
  }),
  submitGitHubReview: vi.fn(async () => ({ reviewId: 1, url: "https://github.com/acme/widget/pull/7#pullrequestreview-1" })),
}));

// Mock @diffprism/analysis — watcher uses analyze
vi.mock("@diffprism/analysis", () => ({
  analyze: vi.fn().mockReturnValue({
    summary: "Mock analysis",
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
  }),
}));

// ─── Import after mocks ───

const { startGlobalServer } = await import("../global-server.js");
const git = await import("@diffprism/git");

// ─── Helpers ───

function makePayload(overrides?: Partial<ReviewInitPayload>): ReviewInitPayload {
  const diffSet: DiffSet = {
    baseRef: "HEAD",
    headRef: "working-copy",
    files: [
      {
        path: "src/index.ts",
        status: "modified",
        hunks: [],
        language: "typescript",
        binary: false,
        additions: 10,
        deletions: 5,
      },
    ],
  };

  const briefing: ReviewBriefing = {
    summary: "Test changes",
    triage: { critical: [], notable: [], mechanical: [] },
    impact: {
      affectedModules: [],
      affectedTests: [],
      publicApiChanges: false,
      breakingChanges: [],
      newDependencies: [],
    },
    verification: { testsPass: null, typeCheck: null, lintClean: null },
    fileStats: [
      {
        path: "src/index.ts",
        language: "typescript",
        status: "modified",
        additions: 10,
        deletions: 5,
      },
    ],
  };

  return {
    reviewId: "test-review",
    diffSet,
    rawDiff: "diff --git a/src/index.ts b/src/index.ts\n",
    briefing,
    metadata: { title: "Test review" },
    ...overrides,
  };
}

let handle: GlobalServerHandle | null = null;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diffprism-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
});

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = null;
  }
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("global-server", () => {
  describe("startGlobalServer", () => {
    it("starts and returns ports", async () => {
      handle = await startGlobalServer({ silent: true });

      expect(handle.httpPort).toBeTypeOf("number");
      expect(handle.wsPort).toBeTypeOf("number");
      expect(handle.httpPort).toBeGreaterThan(0);
      expect(handle.wsPort).toBeGreaterThan(0);
    });

    it("responds to GET /api/status", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(`http://localhost:${handle.httpPort}/api/status`);
      expect(response.ok).toBe(true);

      const data = (await response.json()) as {
        running: boolean;
        pid: number;
        sessions: number;
      };
      expect(data.running).toBe(true);
      expect(data.pid).toBe(process.pid);
      expect(data.sessions).toBe(0);
    });
  });

  describe("session management", () => {
    it("creates a session via POST /api/reviews", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(
        `http://localhost:${handle.httpPort}/api/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payload: makePayload(),
            projectPath: "/test/project",
          }),
        },
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as { sessionId: string };
      expect(data.sessionId).toMatch(/^session-/);
    });

    it("lists sessions via GET /api/reviews", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create two sessions
      await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Review A" } }),
          projectPath: "/project-a",
        }),
      });

      await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Review B" } }),
          projectPath: "/project-b",
        }),
      });

      const response = await fetch(`${baseUrl}/api/reviews`);
      expect(response.ok).toBe(true);

      const data = (await response.json()) as {
        sessions: Array<{
          id: string;
          projectPath: string;
          title: string;
          fileCount: number;
          additions: number;
          deletions: number;
          status: string;
        }>;
      };
      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0].fileCount).toBe(1);
      expect(data.sessions[0].additions).toBe(10);
      expect(data.sessions[0].deletions).toBe(5);
    });

    it("gets a session by ID via GET /api/reviews/:id", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Specific Review" } }),
          projectPath: "/specific/project",
        }),
      });

      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      expect(response.ok).toBe(true);

      const data = (await response.json()) as {
        id: string;
        projectPath: string;
        title: string;
      };
      expect(data.id).toBe(sessionId);
      expect(data.projectPath).toBe("/specific/project");
      expect(data.title).toBe("Specific Review");
    });

    it("returns 404 for non-existent session", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(
        `http://localhost:${handle.httpPort}/api/reviews/nonexistent`,
      );
      expect(response.status).toBe(404);
    });
  });

  describe("review results", () => {
    it("session status changes to submitted after result submission", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Verify initial status is pending
      const beforeResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      const beforeData = (await beforeResponse.json()) as { status: string };
      expect(beforeData.status).toBe("pending");

      // Submit result
      await fetch(`${baseUrl}/api/reviews/${sessionId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "approved",
          comments: [],
        } satisfies ReviewResult),
      });

      // Verify status changed to submitted
      const afterResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      const afterData = (await afterResponse.json()) as { status: string };
      expect(afterData.status).toBe("submitted");
    });

    // The dashboard sends a verdict over HTTP and shows the reply, so a
    // verdict that can't be recorded has to say so rather than vanish (#203).
    it("refuses a verdict for a review that no longer exists", async () => {
      handle = await startGlobalServer({ silent: true });
      const response = await fetch(`http://localhost:${handle.httpPort}/api/reviews/session-gone/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved", comments: [] }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Session not found" });
    });

    it("refuses a verdict it can't read", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: makePayload(), projectPath: "/test" }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });

      expect(response.status).toBe(400);
      const { result } = (await (await fetch(`${baseUrl}/api/reviews/${sessionId}/result`)).json()) as { result: unknown };
      expect(result).toBeNull();
    });

    it("submits and retrieves a review result", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // No result yet
      const noResultResponse = await fetch(
        `${baseUrl}/api/reviews/${sessionId}/result`,
      );
      const noResultData = (await noResultResponse.json()) as {
        result: null;
        status: string;
      };
      expect(noResultData.result).toBeNull();
      expect(noResultData.status).toBe("pending");

      // Submit result
      const result: ReviewResult = {
        decision: "approved",
        comments: [],
        summary: "LGTM",
      };

      const submitResponse = await fetch(
        `${baseUrl}/api/reviews/${sessionId}/result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        },
      );
      expect(submitResponse.ok).toBe(true);

      // Retrieve result
      const resultResponse = await fetch(
        `${baseUrl}/api/reviews/${sessionId}/result`,
      );
      const resultData = (await resultResponse.json()) as {
        result: ReviewResult;
        status: string;
      };
      expect(resultData.result.decision).toBe("approved");
      expect(resultData.result.summary).toBe("LGTM");
      expect(resultData.status).toBe("submitted");
    });
  });

  describe("context updates", () => {
    it("updates session context via POST /api/reviews/:id/context", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Original Title" } }),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Update context
      const contextPayload: ContextUpdatePayload = {
        title: "Updated Title",
        reasoning: "New reasoning",
      };

      const updateResponse = await fetch(
        `${baseUrl}/api/reviews/${sessionId}/context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(contextPayload),
        },
      );
      expect(updateResponse.ok).toBe(true);
    });
  });

  describe("session:updated broadcasts", () => {
    it("includes decision in session summary after result submission", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Submit result with decision
      const result: ReviewResult = {
        decision: "changes_requested",
        comments: [{ file: "src/index.ts", line: 5, side: "new", body: "Fix this", type: "must_fix" }],
      };

      await fetch(`${baseUrl}/api/reviews/${sessionId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });

      // Verify decision appears in GET /api/reviews/:id
      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      const data = (await response.json()) as SessionSummary;
      expect(data.decision).toBe("changes_requested");
      expect(data.status).toBe("submitted");
    });

    it("broadcasts session:updated to WS clients when result is submitted via HTTP", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Connect WS client (without sessionId — server mode)
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);

      const messages: ServerMessage[] = [];
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()) as ServerMessage);
      });

      // Wait for initial session:list message
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Submit result via HTTP
      const result: ReviewResult = {
        decision: "approved",
        comments: [],
        summary: "LGTM",
      };

      await fetch(`${baseUrl}/api/reviews/${sessionId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });

      // Wait for broadcast
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.close();

      const updateMsg = messages.find((m) => m.type === "session:updated");
      expect(updateMsg).toBeDefined();
      expect(updateMsg!.type).toBe("session:updated");
      const payload = updateMsg!.payload as SessionSummary;
      expect(payload.id).toBe(sessionId);
      expect(payload.status).toBe("submitted");
      expect(payload.decision).toBe("approved");
    });

    it("broadcasts session:updated when session transitions to in_review", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create two sessions so auto-select doesn't trigger
      await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "First" } }),
          projectPath: "/test-a",
        }),
      });

      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Second" } }),
          projectPath: "/test-b",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Connect WS client without sessionId (server mode)
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);

      const messages: ServerMessage[] = [];
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()) as ServerMessage);
      });

      // Wait for initial session:list
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Select a session — triggers in_review transition
      ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));

      // Wait for broadcast
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.close();

      const updateMsg = messages.find((m) => m.type === "session:updated");
      expect(updateMsg).toBeDefined();
      const payload = updateMsg!.payload as SessionSummary;
      expect(payload.id).toBe(sessionId);
      expect(payload.status).toBe("in_review");
    });
  });

  describe("session deletion", () => {
    it("deletes a session via DELETE /api/reviews/:id", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Delete
      const deleteResponse = await fetch(
        `${baseUrl}/api/reviews/${sessionId}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.ok).toBe(true);

      // Verify it's gone
      const getResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      expect(getResponse.status).toBe(404);
    });
  });

  describe("dismiss behavior", () => {
    it("session:close stores dismissed result for MCP polling", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Connect WS client and select the session
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);

      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      // Wait for initial messages
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Select the session first
      ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Close session via session:close
      ws.send(JSON.stringify({ type: "session:close", payload: { sessionId } }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.close();

      // MCP should still be able to poll the dismissed result
      const resultResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}/result`);
      const resultData = (await resultResponse.json()) as {
        result: ReviewResult;
        status: string;
      };
      expect(resultData.result).not.toBeNull();
      expect(resultData.result.decision).toBe("dismissed");
      expect(resultData.status).toBe("submitted");
    });

    it("dismissed result via HTTP broadcasts session:removed", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Connect WS client
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);

      const messages: ServerMessage[] = [];
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()) as ServerMessage);
      });

      // Wait for initial messages
      await new Promise((resolve) => setTimeout(resolve, 50));
      messages.length = 0;

      // Submit dismissed result via HTTP
      await fetch(`${baseUrl}/api/reviews/${sessionId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "dismissed", comments: [] }),
      });

      // Wait for broadcast
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.close();

      const removedMsg = messages.find((m) => m.type === "session:removed");
      expect(removedMsg).toBeDefined();
      expect((removedMsg!.payload as { sessionId: string }).sessionId).toBe(sessionId);

      // MCP can still poll the result
      const resultResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}/result`);
      const resultData = (await resultResponse.json()) as {
        result: ReviewResult;
        status: string;
      };
      expect(resultData.result.decision).toBe("dismissed");
    });
  });

  describe("session deduplication by projectPath", () => {
    it("reuses session when same projectPath is posted twice", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const firstResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "First review" } }),
          projectPath: "/same/project",
        }),
      });

      expect(firstResponse.status).toBe(201);
      const { sessionId: firstId } = (await firstResponse.json()) as { sessionId: string };

      const secondResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Second review" } }),
          projectPath: "/same/project",
        }),
      });

      expect(secondResponse.status).toBe(200);
      const { sessionId: secondId } = (await secondResponse.json()) as { sessionId: string };

      // Same session ID reused
      expect(secondId).toBe(firstId);

      // Only one session in the list
      const listResponse = await fetch(`${baseUrl}/api/reviews`);
      const listData = (await listResponse.json()) as { sessions: SessionSummary[] };
      expect(listData.sessions).toHaveLength(1);
      expect(listData.sessions[0].title).toBe("Second review");
    });

    it("resets status and clears result when same projectPath is posted after submit", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Submit a result
      await fetch(`${baseUrl}/api/reviews/${sessionId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "approved",
          comments: [],
        } satisfies ReviewResult),
      });

      // Verify submitted
      const afterSubmit = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      const afterSubmitData = (await afterSubmit.json()) as SessionSummary;
      expect(afterSubmitData.status).toBe("submitted");

      // Post again with same projectPath
      const secondResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // A different diff: a new question, so the old verdict must not stand.
          payload: makePayload({
            metadata: { title: "New review" },
            rawDiff: "diff --git a/src/other.ts b/src/other.ts\n",
          }),
          projectPath: "/test/project",
        }),
      });

      expect(secondResponse.status).toBe(200);
      const { sessionId: secondId } = (await secondResponse.json()) as { sessionId: string };
      expect(secondId).toBe(sessionId);

      // Status reset to pending, result cleared
      const afterReset = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      const afterResetData = (await afterReset.json()) as SessionSummary;
      expect(afterResetData.status).toBe("pending");
      expect(afterResetData.decision).toBeUndefined();

      // Result endpoint also shows pending
      const resultResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}/result`);
      const resultData = (await resultResponse.json()) as { result: null; status: string };
      expect(resultData.result).toBeNull();
      expect(resultData.status).toBe("pending");
    });

    it("creates separate sessions for different projectPaths", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const firstResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Project A" } }),
          projectPath: "/project-a",
        }),
      });
      const { sessionId: firstId } = (await firstResponse.json()) as { sessionId: string };

      const secondResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Project B" } }),
          projectPath: "/project-b",
        }),
      });
      const { sessionId: secondId } = (await secondResponse.json()) as { sessionId: string };

      // Different session IDs
      expect(secondId).not.toBe(firstId);

      // Two sessions in the list
      const listResponse = await fetch(`${baseUrl}/api/reviews`);
      const listData = (await listResponse.json()) as { sessions: SessionSummary[] };
      expect(listData.sessions).toHaveLength(2);
    });
  });

  describe("git refs endpoint", () => {
    it("returns branches and commits for a session via GET /api/reviews/:id/refs", async () => {
      // Re-establish mock return values (vi.restoreAllMocks clears them between tests)
      vi.mocked(git.listBranches).mockReturnValue({
        local: ["main", "feature-branch"],
        remote: ["origin/main", "origin/develop"],
      });
      vi.mocked(git.listCommits).mockReturnValue([
        {
          hash: "abc123full",
          shortHash: "abc123",
          subject: "Initial commit",
          author: "Test Author",
          date: "2025-01-15T10:30:00Z",
        },
      ]);
      vi.mocked(git.getCurrentBranch).mockReturnValue("main");

      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}/refs`);
      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        branches: { local: string[]; remote: string[] };
        commits: Array<{ hash: string; shortHash: string; subject: string }>;
        currentBranch: string;
      };
      expect(data.branches.local).toContain("main");
      expect(data.branches.remote).toContain("origin/main");
      expect(data.commits).toHaveLength(1);
      expect(data.currentBranch).toBe("main");
    });

    it("returns 404 for refs of non-existent session", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(
        `http://localhost:${handle.httpPort}/api/reviews/nonexistent/refs`,
      );
      expect(response.status).toBe(404);
    });
  });

  describe("compare endpoint", () => {
    it("recomputes diff for a new ref via POST /api/reviews/:id/compare", async () => {
      // Re-establish mock return values (vi.restoreAllMocks clears them between tests)
      vi.mocked(git.getDiff).mockReturnValue({
        diffSet: {
          baseRef: "HEAD",
          headRef: "main",
          files: [
            {
              path: "src/index.ts",
              status: "modified",
              hunks: [],
              language: "typescript",
              binary: false,
              additions: 5,
              deletions: 2,
            },
          ],
        },
        rawDiff: "diff --git a/src/index.ts b/src/index.ts\n",
      });

      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
          diffRef: "working-copy",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main" }),
      });

      expect(response.ok).toBe(true);
      const data = (await response.json()) as { ok: boolean; fileCount: number };
      expect(data.ok).toBe(true);
      expect(data.fileCount).toBe(1);
    });

    it("returns 404 for compare on non-existent session", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(
        `http://localhost:${handle.httpPort}/api/reviews/nonexistent/compare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref: "main" }),
        },
      );
      expect(response.status).toBe(404);
    });

    it("returns 400 when ref is missing from body", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("annotations", () => {
    it("posts an annotation to a session", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Post annotation
      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "src/index.ts",
          line: 42,
          body: "This function has no error handling",
          type: "finding",
          confidence: 0.9,
          category: "correctness",
          source: { agent: "security-reviewer", tool: "static-analysis" },
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { annotationId: string };
      expect(data.annotationId).toBeDefined();
      expect(typeof data.annotationId).toBe("string");
    });

    it("retrieves annotations for a session", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Post two annotations
      await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "src/index.ts",
          line: 10,
          body: "Missing null check",
          type: "finding",
          source: { agent: "correctness-agent" },
        }),
      });

      await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "src/utils.ts",
          line: 25,
          body: "Consider using a Map instead of Object",
          type: "suggestion",
          category: "performance",
          source: { agent: "perf-agent" },
        }),
      });

      // Get annotations
      const response = await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`);
      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        annotations: Array<{
          id: string;
          sessionId: string;
          file: string;
          line: number;
          body: string;
          type: string;
          confidence: number;
          category: string;
          source: { agent: string };
          createdAt: number;
        }>;
      };

      expect(data.annotations).toHaveLength(2);
      expect(data.annotations[0].file).toBe("src/index.ts");
      expect(data.annotations[0].body).toBe("Missing null check");
      expect(data.annotations[0].type).toBe("finding");
      expect(data.annotations[0].confidence).toBe(1); // default
      expect(data.annotations[0].category).toBe("other"); // default
      expect(data.annotations[0].source.agent).toBe("correctness-agent");
      expect(data.annotations[0].sessionId).toBe(sessionId);
      expect(data.annotations[0].createdAt).toBeTypeOf("number");

      expect(data.annotations[1].file).toBe("src/utils.ts");
      expect(data.annotations[1].category).toBe("performance");
    });

    it("returns 404 when posting annotation to non-existent session", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(
        `http://localhost:${handle.httpPort}/api/reviews/nonexistent/annotations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: "src/index.ts",
            line: 1,
            body: "test",
            type: "finding",
            source: { agent: "test-agent" },
          }),
        },
      );

      expect(response.status).toBe(404);
    });

    it("returns 404 when getting annotations for non-existent session", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(
        `http://localhost:${handle.httpPort}/api/reviews/nonexistent/annotations`,
      );

      expect(response.status).toBe(404);
    });

    it("dismisses an annotation", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Post annotation
      const annotationResponse = await fetch(
        `${baseUrl}/api/reviews/${sessionId}/annotations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: "src/index.ts",
            line: 5,
            body: "Nitpick: variable naming",
            type: "suggestion",
            category: "convention",
            source: { agent: "style-agent" },
          }),
        },
      );
      const { annotationId } = (await annotationResponse.json()) as { annotationId: string };

      // Dismiss annotation
      const dismissResponse = await fetch(
        `${baseUrl}/api/reviews/${sessionId}/annotations/${annotationId}/dismiss`,
        { method: "POST" },
      );
      expect(dismissResponse.status).toBe(200);

      // Verify dismissed flag
      const getResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`);
      const data = (await getResponse.json()) as {
        annotations: Array<{ id: string; dismissed?: boolean }>;
      };
      const dismissed = data.annotations.find((a) => a.id === annotationId);
      expect(dismissed).toBeDefined();
      expect(dismissed!.dismissed).toBe(true);
    });

    it("returns 404 when dismissing non-existent annotation", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session
      const createResponse = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });
      const { sessionId } = (await createResponse.json()) as { sessionId: string };

      // Try to dismiss non-existent annotation
      const response = await fetch(
        `${baseUrl}/api/reviews/${sessionId}/annotations/nonexistent-id/dismiss`,
        { method: "POST" },
      );
      expect(response.status).toBe(404);
    });

    it("returns 404 when dismissing annotation on non-existent session", async () => {
      handle = await startGlobalServer({ silent: true });

      const response = await fetch(
        `http://localhost:${handle.httpPort}/api/reviews/nonexistent/annotations/some-id/dismiss`,
        { method: "POST" },
      );
      expect(response.status).toBe(404);
    });
  });

  describe("live diff watching", () => {
    it("stores diffRef when provided in POST /api/reviews", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const response = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
          diffRef: "working-copy",
        }),
      });

      expect(response.status).toBe(201);
      const { sessionId } = (await response.json()) as { sessionId: string };

      // Verify session has hasNewChanges: false initially
      const getResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      const data = (await getResponse.json()) as SessionSummary;
      expect(data.hasNewChanges).toBe(false);
    });

    it("sets watchMode on payload when diffRef is provided", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create session with diffRef
      const response = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
          diffRef: "staged",
        }),
      });

      expect(response.status).toBe(201);
    });

    it("session without diffRef has hasNewChanges false", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const response = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload(),
          projectPath: "/test/project",
        }),
      });

      const { sessionId } = (await response.json()) as { sessionId: string };

      const getResponse = await fetch(`${baseUrl}/api/reviews/${sessionId}`);
      const data = (await getResponse.json()) as SessionSummary;
      expect(data.hasNewChanges).toBe(false);
    });

    it("includes hasNewChanges in session list", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      // Create two sessions
      await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "With diff" } }),
          projectPath: "/project-a",
          diffRef: "working-copy",
        }),
      });

      await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: makePayload({ metadata: { title: "Without diff" } }),
          projectPath: "/project-b",
        }),
      });

      const response = await fetch(`${baseUrl}/api/reviews`);
      const data = (await response.json()) as { sessions: SessionSummary[] };

      expect(data.sessions).toHaveLength(2);
      for (const session of data.sessions) {
        expect(session.hasNewChanges).toBe(false);
      }
    });
  });
});

// ─── #153: closed sessions stay closed ───

describe("closing a session", () => {
  async function createSession(baseUrl: string, projectPath: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: makePayload(), projectPath }),
    });
    return ((await response.json()) as { sessionId: string }).sessionId;
  }

  /** Connect a UI client the way the dashboard does, and collect what it hears. */
  async function connectUi(wsPort: number) {
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as ServerMessage);
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { ws, messages };
  }

  async function closeFromUi(wsPort: number, sessionId: string): Promise<void> {
    const { ws } = await connectUi(wsPort);
    ws.send(JSON.stringify({ type: "session:close", payload: { sessionId } }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();
  }

  it("does not hand a closed session back when the UI reconnects", async () => {
    // The reported bug: close a session, come back, and it is still there,
    // because every listing path returned the whole session map.
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const closedId = await createSession(baseUrl, "/repo-closed");
    const keptId = await createSession(baseUrl, "/repo-kept");

    await closeFromUi(handle.wsPort, closedId);

    const { ws, messages } = await connectUi(handle.wsPort);
    ws.close();

    const list = messages.find((m) => m.type === "session:list");
    expect(list).toBeDefined();
    const ids = (list!.payload as SessionSummary[]).map((s) => s.id);
    expect(ids).toContain(keptId);
    expect(ids).not.toContain(closedId);
  });

  it("omits a closed session from GET /api/reviews", async () => {
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const closedId = await createSession(baseUrl, "/repo-closed");
    await closeFromUi(handle.wsPort, closedId);

    const body = (await (await fetch(`${baseUrl}/api/reviews`)).json()) as {
      sessions: SessionSummary[];
    };
    expect(body.sessions.map((s) => s.id)).not.toContain(closedId);
  });

  it("still lets a blocked caller read the dismissed verdict", async () => {
    // Deleting the session outright would make a CLI review, pre-commit hook,
    // or MCP poll get a 404 and hang until its timeout. It has to stay readable.
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const sessionId = await createSession(baseUrl, "/repo-polled");
    await closeFromUi(handle.wsPort, sessionId);

    const response = await fetch(`${baseUrl}/api/reviews/${sessionId}/result`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { result: ReviewResult | null };
    expect(body.result?.decision).toBe("dismissed");
  });

  it("brings the session back, announced as new, when a later review reuses it", async () => {
    // The UI dropped the closed session and ignores session:updated for ids it
    // does not hold — so a reopened session has to arrive as session:added or
    // the new review never shows up.
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const sessionId = await createSession(baseUrl, "/repo-reopened");
    await closeFromUi(handle.wsPort, sessionId);

    const { ws, messages } = await connectUi(handle.wsPort);
    const reusedId = await createSession(baseUrl, "/repo-reopened");
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();

    expect(reusedId).toBe(sessionId);

    const added = messages.find(
      (m) => m.type === "session:added" && (m.payload as SessionSummary).id === sessionId,
    );
    expect(added).toBeDefined();

    const body = (await (await fetch(`${baseUrl}/api/reviews`)).json()) as {
      sessions: SessionSummary[];
    };
    expect(body.sessions.map((s) => s.id)).toContain(sessionId);
  });
});

// ─── #163: one session per repo, one rule for every open path ───

describe("session identity", () => {
  beforeEach(async () => {
    // Earlier tests' afterEach restoreAllMocks wipes mockReturnValue state on
    // these module mocks, so set what this suite relies on explicitly.
    vi.mocked(git.getRepoRoot).mockReturnValue(null);
    vi.mocked(git.getCurrentBranch).mockReturnValue("main");
    vi.mocked(git.getDiff).mockReturnValue({
      diffSet: { baseRef: "HEAD", headRef: "working-copy", files: [] },
      rawDiff: "",
    });
    const analysis = await import("@diffprism/analysis");
    vi.mocked(analysis.analyze).mockReturnValue({
      summary: "Mock analysis",
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
    });
  });

  async function post(baseUrl: string, route: string, body: unknown) {
    return fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function openLocal(baseUrl: string, projectPath: string, diffRef?: string, rawDiff?: string) {
    const response = await post(baseUrl, "/api/reviews", {
      payload: rawDiff ? makePayload({ rawDiff }) : makePayload(),
      projectPath,
      diffRef,
    });
    return ((await response.json()) as { sessionId: string }).sessionId;
  }

  async function listSessions(baseUrl: string): Promise<SessionSummary[]> {
    const body = (await (await fetch(`${baseUrl}/api/reviews`)).json()) as {
      sessions: SessionSummary[];
    };
    return body.sessions;
  }

  async function annotate(baseUrl: string, sessionId: string, type: string) {
    const response = await post(baseUrl, `/api/reviews/${sessionId}/annotations`, {
      file: "src/index.ts",
      line: 1,
      body: `a ${type}`,
      type,
      source: { agent: "test", tool: "test" },
    });
    return ((await response.json()) as { annotationId: string }).annotationId;
  }

  describe("reuse", () => {
    it("keeps annotations when a second review lands on the same repo", async () => {
      // Reuse used to wipe them, destroying an agent's findings whenever a
      // hook or a second open hit the repo.
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const sessionId = await openLocal(baseUrl, "/repo");
      await annotate(baseUrl, sessionId, "finding");
      await openLocal(baseUrl, "/repo");

      const body = (await (await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`)).json()) as {
        annotations: Annotation[];
      };
      expect(body.annotations).toHaveLength(1);
    });

    it("does not reset a session that is mid-review", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const sessionId = await openLocal(baseUrl, "/repo");
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));
      ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      await openLocal(baseUrl, "/repo");
      ws.close();

      const session = (await listSessions(baseUrl)).find((s) => s.id === sessionId);
      expect(session?.status).toBe("in_review");
    });

    it("clears a previous verdict when the diff has changed", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const sessionId = await openLocal(baseUrl, "/repo");
      await post(baseUrl, `/api/reviews/${sessionId}/result`, { decision: "approved", comments: [] });
      await openLocal(baseUrl, "/repo", undefined, "diff --git a/changed.ts b/changed.ts\n");

      const body = (await (await fetch(`${baseUrl}/api/reviews/${sessionId}/result`)).json()) as {
        result: ReviewResult | null;
      };
      expect(body.result).toBeNull();
    });

    describe("a verdict answers a specific diff (#161)", () => {
      // The retry case: an agent's `git commit` hits its shell timeout while
      // the human is still reviewing, or open_review returns timed_out. The
      // reviewer decides; the agent tries again with the same diff. It must get
      // that decision, not a wiped session and a second review request.
      async function resultOf(baseUrl: string, sessionId: string) {
        return ((await (await fetch(`${baseUrl}/api/reviews/${sessionId}/result`)).json()) as {
          result: ReviewResult | null;
        }).result;
      }

      it("keeps an approval when the identical diff is reopened", async () => {
        handle = await startGlobalServer({ silent: true });
        const baseUrl = `http://localhost:${handle.httpPort}`;

        const sessionId = await openLocal(baseUrl, "/repo");
        await post(baseUrl, `/api/reviews/${sessionId}/result`, { decision: "approved", comments: [] });
        await openLocal(baseUrl, "/repo");

        expect((await resultOf(baseUrl, sessionId))?.decision).toBe("approved");
        const session = (await listSessions(baseUrl)).find((s) => s.id === sessionId);
        expect(session?.status).toBe("submitted");
      });

      it("keeps requested changes — and their feedback — for an unchanged diff", async () => {
        handle = await startGlobalServer({ silent: true });
        const baseUrl = `http://localhost:${handle.httpPort}`;

        const sessionId = await openLocal(baseUrl, "/repo");
        await post(baseUrl, `/api/reviews/${sessionId}/result`, {
          decision: "changes_requested",
          comments: [],
          summary: "what is this?",
        });
        await openLocal(baseUrl, "/repo");

        const result = await resultOf(baseUrl, sessionId);
        expect(result?.decision).toBe("changes_requested");
        expect(result?.summary).toBe("what is this?");
      });

      it("does not carry a dismissal over, since dismissing is not a decision", async () => {
        handle = await startGlobalServer({ silent: true });
        const baseUrl = `http://localhost:${handle.httpPort}`;

        const sessionId = await openLocal(baseUrl, "/repo");
        await post(baseUrl, `/api/reviews/${sessionId}/result`, { decision: "dismissed", comments: [] });
        await openLocal(baseUrl, "/repo");

        expect(await resultOf(baseUrl, sessionId)).toBeNull();
      });

      it("does not report a retry of the identical diff as new changes", async () => {
        handle = await startGlobalServer({ silent: true });
        const baseUrl = `http://localhost:${handle.httpPort}`;

        const sessionId = await openLocal(baseUrl, "/repo");
        await openLocal(baseUrl, "/repo");

        const session = (await listSessions(baseUrl)).find((s) => s.id === sessionId);
        expect(session?.hasNewChanges).toBe(false);
      });
    });

    it("switches to the new ref", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const sessionId = await openLocal(baseUrl, "/repo", "working-copy");
      await openLocal(baseUrl, "/repo", "staged");

      const body = (await (await fetch(`${baseUrl}/api/reviews/${sessionId}`)).json()) as SessionSummary;
      expect(body.diffRef).toBe("staged");
    });

    it("raises the new-changes signal when nobody is watching", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const sessionId = await openLocal(baseUrl, "/repo");
      await openLocal(baseUrl, "/repo", undefined, "diff --git a/changed.ts b/changed.ts\n");

      const session = (await listSessions(baseUrl)).find((s) => s.id === sessionId);
      expect(session?.hasNewChanges).toBe(true);
    });
  });

  describe("one rule for every open path", () => {
    it("reuses a UI-opened session when a hook or agent opens the same repo", async () => {
      // The reported collision: "Open Project" never deduped, agent opens did,
      // so the two produced separate live-watching sessions for one repo.
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const opened = await post(baseUrl, "/api/projects/open", { projectPath: tmpDir });
      const { sessionId: manualId } = (await opened.json()) as { sessionId: string };

      const agentId = await openLocal(baseUrl, tmpDir);

      expect(agentId).toBe(manualId);
      expect(await listSessions(baseUrl)).toHaveLength(1);
    });

    it("treats a subdirectory and its repo root as the same repo", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      vi.mocked(git.getRepoRoot).mockReturnValue("/work/app");

      const fromRoot = await openLocal(baseUrl, "/work/app");
      const fromSubdir = await openLocal(baseUrl, "/work/app/packages/core");

      expect(fromSubdir).toBe(fromRoot);
    });

    it("keeps worktrees independent", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      vi.mocked(git.getRepoRoot).mockImplementation(({ cwd } = {}) => cwd ?? null);

      const main = await openLocal(baseUrl, "/work/app");
      const worktree = await openLocal(baseUrl, "/work/app/.claude/worktrees/feature");

      expect(worktree).not.toBe(main);
    });

    it("does not let a PR review and a working-copy review of the same repo overwrite each other", async () => {
      // A PR session reads from the local clone, so keying it by repo would
      // collide with a working-copy review of that clone.
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      vi.mocked(git.getRepoRoot).mockReturnValue("/work/widget");

      const localId = await openLocal(baseUrl, "/work/widget");
      const prResponse = await post(baseUrl, "/api/pr/open", { prUrl: "acme/widget#7" });
      const { sessionId: prId } = (await prResponse.json()) as { sessionId: string };

      expect(prId).not.toBe(localId);
      expect(await listSessions(baseUrl)).toHaveLength(2);
    });

    it("gives a PR review the title and reasoning it was opened with (#198)", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      await post(baseUrl, "/api/pr/open", { prUrl: "acme/widget#7", title: "Cache fix", reasoning: "Stale reads after deploy" });

      expect(vi.mocked(github.normalizePr)).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        { title: "Cache fix", reasoning: "Stale reads after deploy" },
      );
    });

    it("reuses a PR session when the same PR is opened again", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const first = await post(baseUrl, "/api/pr/open", { prUrl: "acme/widget#7" });
      const second = await post(baseUrl, "/api/pr/open", { prUrl: "acme/widget#7" });

      const a = ((await first.json()) as { sessionId: string }).sessionId;
      const b = ((await second.json()) as { sessionId: string }).sessionId;
      expect(b).toBe(a);
      expect(second.status).toBe(200);
    });
  });

  describe("GET /api/reviews/resolve", () => {
    it("finds nothing for a repo with no session", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const body = (await (await fetch(`${baseUrl}/api/reviews/resolve?path=/nowhere`)).json()) as {
        sessions: SessionSummary[];
      };
      expect(body.sessions).toEqual([]);
    });

    it("finds the one session for a repo", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      vi.mocked(git.getRepoRoot).mockReturnValue("/work/app");

      const sessionId = await openLocal(baseUrl, "/work/app");
      const body = (await (await fetch(`${baseUrl}/api/reviews/resolve?path=/work/app/src`)).json()) as {
        sessions: SessionSummary[];
      };
      expect(body.sessions.map((s) => s.id)).toEqual([sessionId]);
    });

    it("returns every match rather than picking one", async () => {
      // A PR review and a working-copy review can share a clone. The resolver
      // must not guess between them.
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      vi.mocked(git.getRepoRoot).mockReturnValue("/work/widget");

      await openLocal(baseUrl, "/work/widget");
      await post(baseUrl, "/api/pr/open", { prUrl: "acme/widget#7" });

      const body = (await (await fetch(`${baseUrl}/api/reviews/resolve?path=/work/widget`)).json()) as {
        sessions: SessionSummary[];
      };
      expect(body.sessions).toHaveLength(2);
    });

    it("finds a PR review with no local clone from any clone of that repo", async () => {
      // "Review PR" in a dashboard whose server runs outside the clone leaves
      // the session with no working tree. An agent in the clone must still
      // find it without being handed a session id.
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      vi.mocked(git.getRepoRoot).mockImplementation((options) => options?.cwd ?? null);
      vi.mocked(git.getGitHubRemotes).mockImplementation((options) =>
        options?.cwd === "/clones/widget" ? ["acme/widget"] : [],
      );

      const prResponse = await post(baseUrl, "/api/pr/open", { prUrl: "acme/widget#7" });
      const { sessionId, localRepoPath } = (await prResponse.json()) as { sessionId: string; localRepoPath: string | null };
      expect(localRepoPath).toBeNull();

      const resolve = async (dir: string) =>
        ((await (await fetch(`${baseUrl}/api/reviews/resolve?path=${dir}`)).json()) as { sessions: SessionSummary[] }).sessions;
      expect((await resolve("/clones/widget")).map((s) => s.id)).toEqual([sessionId]);
      expect(await resolve("/clones/other")).toEqual([]);
    });

    it("requires a path", async () => {
      handle = await startGlobalServer({ silent: true });
      const response = await fetch(`http://localhost:${handle.httpPort}/api/reviews/resolve`);
      expect(response.status).toBe(400);
    });
  });

  describe("attention", () => {
    it("flags a session a warning lands on, and tells every client", async () => {
      // annotation:added only reaches clients viewing that session, so this
      // used to be unable to flag a session you were not looking at.
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openLocal(baseUrl, "/repo");
      // With exactly one session the handshake auto-selects it, which would
      // make this client a viewer — and a viewer has already seen the warning.
      await openLocal(baseUrl, "/other-repo");

      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);
      const messages: ServerMessage[] = [];
      ws.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));

      await annotate(baseUrl, sessionId, "warning");
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.close();

      const update = messages.find(
        (m) => m.type === "session:updated" && (m.payload as SessionSummary).id === sessionId,
      );
      expect((update?.payload as SessionSummary | undefined)?.needsAttention).toBe(true);
    });

    it("does not flag for findings, only warnings", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openLocal(baseUrl, "/repo");

      await annotate(baseUrl, sessionId, "finding");

      const session = (await listSessions(baseUrl)).find((s) => s.id === sessionId);
      expect(session?.needsAttention).toBe(false);
    });

    it("survives a session list push — it is server state, not client state", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openLocal(baseUrl, "/repo");
      await annotate(baseUrl, sessionId, "warning");

      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);
      const messages: ServerMessage[] = [];
      ws.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.close();

      const list = messages.find((m) => m.type === "session:list");
      const session = (list?.payload as SessionSummary[]).find((s) => s.id === sessionId);
      expect(session?.needsAttention).toBe(true);
    });

    it("clears once the session is selected", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openLocal(baseUrl, "/repo");
      await annotate(baseUrl, sessionId, "warning");
      await new Promise((resolve) => setTimeout(resolve, 5));

      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));
      ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.close();

      const session = (await listSessions(baseUrl)).find((s) => s.id === sessionId);
      expect(session?.needsAttention).toBe(false);
    });

    it("clears when the warning is dismissed", async () => {
      handle = await startGlobalServer({ silent: true });
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openLocal(baseUrl, "/repo");
      const annotationId = await annotate(baseUrl, sessionId, "warning");

      await post(baseUrl, `/api/reviews/${sessionId}/annotations/${annotationId}/dismiss`, {});

      const session = (await listSessions(baseUrl)).find((s) => s.id === sessionId);
      expect(session?.needsAttention).toBe(false);
    });
  });
});

// ─── #164: the server owns the default scope and the reset target ───

describe("diff scope", () => {
  beforeEach(() => {
    vi.mocked(git.getRepoRoot).mockReturnValue(null);
    vi.mocked(git.getDiff).mockReturnValue({
      diffSet: { baseRef: "HEAD", headRef: "working-copy", files: [] },
      rawDiff: "",
    });
  });

  it("reports its default scope so the dashboard doesn't keep a copy", async () => {
    handle = await startGlobalServer({ silent: true });
    const status = (await (await fetch(`http://localhost:${handle.httpPort}/api/status`)).json()) as {
      defaultDiffRef?: string;
    };
    expect(status.defaultDiffRef).toBe("working-copy");
  });

  it("opens a project on the default scope when none is given", async () => {
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const opened = await fetch(`${baseUrl}/api/projects/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath: tmpDir }),
    });
    const { sessionId } = (await opened.json()) as { sessionId: string };

    const summary = (await (await fetch(`${baseUrl}/api/reviews/${sessionId}`)).json()) as SessionSummary;
    expect(summary.diffRef).toBe("working-copy");
  });

  it("resets a comparison to the ref the session was opened with, not a guess", async () => {
    // The UI used to reset to "working-copy" unconditionally — for a staged
    // commit-gate review that shows edits the commit doesn't include.
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const created = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: makePayload(), projectPath: "/repo", diffRef: "staged" }),
    });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const compare = (body: unknown) =>
      fetch(`${baseUrl}/api/reviews/${sessionId}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    await compare({ ref: "HEAD~1..HEAD" });
    const reset = await compare({ reset: true });
    expect(reset.ok).toBe(true);

    const summary = (await (await fetch(`${baseUrl}/api/reviews/${sessionId}`)).json()) as SessionSummary;
    expect(summary.diffRef).toBe("staged");
  });
});

// ─── #165: bounded watcher cost ───

describe("watcher cost", () => {
  let rawDiff: string;

  beforeEach(() => {
    rawDiff = "diff A";
    vi.mocked(git.getRepoRoot).mockReturnValue(null);
    vi.mocked(git.getCurrentBranch).mockReturnValue("main");
    vi.mocked(git.getDiff).mockImplementation(() => ({
      diffSet: { baseRef: "HEAD", headRef: "working-copy", files: [] },
      rawDiff,
    }));
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function openWatched(baseUrl: string, projectPath: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: makePayload({ rawDiff }), projectPath, diffRef: "working-copy" }),
    });
    return ((await response.json()) as { sessionId: string }).sessionId;
  }

  function gitCallsFor(projectPath: string): number {
    return vi.mocked(git.getDiff).mock.calls.filter((c) => (c[1] as { cwd?: string })?.cwd === projectPath).length;
  }

  async function connect(wsPort: number) {
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    return { ws, messages };
  }

  it("barely polls a session nobody is viewing", async () => {
    // Before: every session ran `git diff` every 2s, viewed or not.
    handle = await startGlobalServer({ silent: true, pollInterval: 20, unviewedPollInterval: 10_000 });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    await openWatched(baseUrl, "/unviewed");
    const afterOpen = gitCallsFor("/unviewed");
    await sleep(300);

    expect(gitCallsFor("/unviewed") - afterOpen).toBe(0);
  });

  it("polls at full speed while someone is viewing", async () => {
    handle = await startGlobalServer({ silent: true, pollInterval: 20, unviewedPollInterval: 10_000 });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const sessionId = await openWatched(baseUrl, "/viewed");
    const { ws } = await connect(handle.wsPort);
    ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
    await sleep(50);
    const afterSelect = gitCallsFor("/viewed");
    await sleep(300);
    ws.close();

    expect(gitCallsFor("/viewed") - afterSelect).toBeGreaterThan(5);
  });

  it("brings a backed-off session up to date the moment someone opens it", async () => {
    // Without the wake, a session backed off to minutes would show a stale
    // diff until its next scheduled poll.
    handle = await startGlobalServer({ silent: true, pollInterval: 10_000, unviewedPollInterval: 60_000 });
    const baseUrl = `http://localhost:${handle.httpPort}`;

    const sessionId = await openWatched(baseUrl, "/stale");
    // Keep the handshake from auto-selecting it before the change lands.
    await openWatched(baseUrl, "/other");
    rawDiff = "diff B — changed while nobody was looking";

    const { ws, messages } = await connect(handle.wsPort);
    ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
    await sleep(100);
    ws.close();

    const update = messages.find((m) => m.type === "diff:update");
    expect((update?.payload as { rawDiff?: string } | undefined)?.rawDiff).toBe(rawDiff);
  });

  describe("idle expiry", () => {
    const quick = { silent: true, idleSessionTtl: 150, cleanupInterval: 50 } as const;

    async function listed(baseUrl: string): Promise<string[]> {
      const body = (await (await fetch(`${baseUrl}/api/reviews`)).json()) as { sessions: SessionSummary[] };
      return body.sessions.map((s) => s.id);
    }

    it("expires an abandoned UI-opened session, which used to live forever", async () => {
      handle = await startGlobalServer(quick);
      const baseUrl = `http://localhost:${handle.httpPort}`;

      const opened = await fetch(`${baseUrl}/api/projects/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: tmpDir }),
      });
      const { sessionId } = (await opened.json()) as { sessionId: string };
      expect(await listed(baseUrl)).toContain(sessionId);

      await sleep(400);
      expect(await listed(baseUrl)).not.toContain(sessionId);
    });

    it("expires an in_review session nobody returned to, which matched no rule at all", async () => {
      handle = await startGlobalServer(quick);
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openWatched(baseUrl, "/in-review");

      const { ws } = await connect(handle.wsPort);
      ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
      await sleep(30);
      ws.close(); // viewed once, then abandoned
      await sleep(400);

      expect(await listed(baseUrl)).not.toContain(sessionId);
    });

    it("keeps a session someone is still waiting on", async () => {
      // A blocked hook or open_review polls the result; that is activity.
      handle = await startGlobalServer(quick);
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openWatched(baseUrl, "/waited-on");

      for (let i = 0; i < 12; i++) {
        await fetch(`${baseUrl}/api/reviews/${sessionId}/result`);
        await sleep(40);
      }

      expect(await listed(baseUrl)).toContain(sessionId);
    });

    it("keeps a session someone is viewing, however long it sits", async () => {
      handle = await startGlobalServer(quick);
      const baseUrl = `http://localhost:${handle.httpPort}`;
      const sessionId = await openWatched(baseUrl, "/viewed-idle");

      const { ws } = await connect(handle.wsPort);
      ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
      await sleep(400);
      const ids = await listed(baseUrl);
      ws.close();

      expect(ids).toContain(sessionId);
    });
  });
});

// ─── #159: feedback ───

describe("GET /api/feedback", () => {
  it("builds a prefilled feedback issue for the dashboard", async () => {
    handle = await startGlobalServer({ silent: true });
    const body = (await (await fetch(`http://localhost:${handle.httpPort}/api/feedback`)).json()) as { url: string };
    expect(new URL(body.url).searchParams.get("labels")).toBe("feedback");
  });

  it("includes the last recorded error in a bug report", async () => {
    const { recordError } = await import("../feedback.js");
    recordError("review", new Error("server refused the review"));

    handle = await startGlobalServer({ silent: true });
    const body = (await (await fetch(`http://localhost:${handle.httpPort}/api/feedback?kind=bug`)).json()) as { url: string };

    const parsed = new URL(body.url);
    expect(parsed.searchParams.get("labels")).toBe("bug");
    expect(parsed.searchParams.get("body")).toContain("server refused the review");
  });
});

// ─── #160: conversation threads ───

describe("threads", () => {
  beforeEach(() => {
    vi.mocked(git.getRepoRoot).mockReturnValue(null);
  });

  async function setup() {
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;
    const created = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: makePayload(), projectPath: "/threads" }),
    });
    const { sessionId } = (await created.json()) as { sessionId: string };
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}/api/reviews/${sessionId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const annotations = async () =>
      ((await (await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`)).json()) as { annotations: Annotation[] }).annotations;
    return { baseUrl, sessionId, post, annotations };
  }

  it("lets the reviewer open a thread on a line", async () => {
    const { post, annotations } = await setup();
    const res = await post("/annotations", {
      file: "src/a.ts", line: 3, body: "why a map here?", type: "question",
      author: "reviewer", source: { agent: "reviewer", tool: "dashboard" },
    });
    expect(res.ok).toBe(true);
    const [thread] = await annotations();
    expect(thread).toMatchObject({ author: "reviewer", body: "why a map here?", replies: [] });
  });

  it("defaults a thread without an author to an agent's, as before threads", async () => {
    const { post, annotations } = await setup();
    await post("/annotations", { file: "a.ts", line: 1, body: "finding", type: "finding", source: { agent: "bot" } });
    expect((await annotations())[0].author).toBe("agent");
  });

  it("appends replies in order, from either side", async () => {
    const { post, annotations } = await setup();
    const opened = await post("/annotations", {
      file: "a.ts", line: 1, body: "why?", type: "question", author: "reviewer", source: { agent: "reviewer" },
    });
    const { annotationId } = (await opened.json()) as { annotationId: string };

    await post(`/annotations/${annotationId}/replies`, { author: "agent", agent: "pr-reviewer", body: "because O(1)" });
    await post(`/annotations/${annotationId}/replies`, { author: "reviewer", body: "fair" });

    const [thread] = await annotations();
    expect(thread.replies?.map((r) => [r.author, r.body])).toEqual([
      ["agent", "because O(1)"],
      ["reviewer", "fair"],
    ]);
    expect(thread.replies?.[0].agent).toBe("pr-reviewer");
  });

  it("records when an agent reads the threads, and only an agent", async () => {
    const { baseUrl, sessionId } = await setup();
    const summary = async () => (await (await fetch(`${baseUrl}/api/reviews/${sessionId}`)).json()) as SessionSummary;

    await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations`);
    expect((await summary()).agentReadAt).toBeUndefined();

    const before = Date.now();
    await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations?reader=agent`);
    expect((await summary()).agentReadAt).toBeGreaterThanOrEqual(before);
  });

  it("tells viewers when an agent picks up a question, not on every read", async () => {
    const { baseUrl, sessionId, post } = await setup();
    await post("/annotations", {
      file: "a.ts", line: 1, body: "why?", type: "question", author: "reviewer", source: { agent: "reviewer" },
    });

    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`ws://localhost:${handle!.wsPort}`);
    const updates: SessionSummary[] = [];
    await new Promise((resolve) => ws.once("open", resolve));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:updated") updates.push(msg.payload);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The question and the read must not share a millisecond: a read only
    // counts for messages strictly older than it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations?reader=agent`);
    await fetch(`${baseUrl}/api/reviews/${sessionId}/annotations?reader=agent`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: sessionId, agentReadAt: expect.any(Number) });
  });

  it("pushes a reply to everyone viewing the session, live", async () => {
    const { post, sessionId } = await setup();
    const opened = await post("/annotations", {
      file: "a.ts", line: 1, body: "why?", type: "question", author: "reviewer", source: { agent: "reviewer" },
    });
    const { annotationId } = (await opened.json()) as { annotationId: string };

    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`ws://localhost:${handle!.wsPort}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    await post(`/annotations/${annotationId}/replies`, { author: "agent", body: "answer" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();

    const update = messages.find((m) => m.type === "annotation:updated");
    expect((update?.payload as Annotation | undefined)?.replies?.[0].body).toBe("answer");
  });

  it("rejects a reply with no body or an unknown author", async () => {
    const { post } = await setup();
    const opened = await post("/annotations", { file: "a.ts", line: 1, body: "x", type: "finding", source: { agent: "bot" } });
    const { annotationId } = (await opened.json()) as { annotationId: string };

    expect((await post(`/annotations/${annotationId}/replies`, { author: "agent", body: "  " })).status).toBe(400);
    expect((await post(`/annotations/${annotationId}/replies`, { author: "someone", body: "hi" })).status).toBe(400);
  });

  it("404s a reply to a thread that doesn't exist", async () => {
    const { post } = await setup();
    expect((await post("/annotations/nope/replies", { author: "agent", body: "hi" })).status).toBe(404);
  });
});

describe("github review", () => {
  beforeEach(() => {
    vi.mocked(git.getRepoRoot).mockReturnValue(null);
  });

  const PR = {
    owner: "acme", repo: "widget", number: 7, title: "Add widget", author: "someone",
    url: "https://github.com/acme/widget/pull/7", baseBranch: "main", headBranch: "feature",
  };

  async function setup(metadata: ReviewInitPayload["metadata"] = { title: "Add widget", githubPr: PR }) {
    handle = await startGlobalServer({ silent: true });
    const baseUrl = `http://localhost:${handle.httpPort}`;
    const created = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: makePayload({ metadata }), projectPath: "github:acme/widget#7" }),
    });
    const { sessionId } = (await created.json()) as { sessionId: string };
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}/api/reviews/${sessionId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const thread = async (body: Record<string, unknown>) =>
      ((await (await post("/annotations", {
        file: "src/cache.ts", line: 4, type: "question", author: "reviewer",
        source: { agent: "reviewer", tool: "dashboard" }, ...body,
      })).json()) as { annotationId: string }).annotationId;
    const session = async () =>
      (await (await fetch(`${baseUrl}/api/reviews/${sessionId}`)).json()) as { status: string; decision?: string };
    return { post, thread, session };
  }

  it("posts the decision, summary and the picked threads — each on its own side of the diff", async () => {
    const { post, thread, session } = await setup();
    const onNew = await thread({ body: "Why lazily?", side: "new" });
    const onOld = await thread({ body: "Why drop includes()?", line: 2, side: "old" });
    await thread({ body: "Private question for the agent" });

    const res = await post("/github-review", {
      event: "REQUEST_CHANGES", summary: "Stale cache", threadIds: [onNew, onOld],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://github.com/acme/widget/pull/7#pullrequestreview-1" });
    expect(github.submitGitHubReview).toHaveBeenCalledWith(expect.anything(), "acme", "widget", 7, {
      event: "REQUEST_CHANGES",
      body: "Stale cache",
      comments: [
        { path: "src/cache.ts", line: 4, side: "RIGHT", body: "Why lazily?" },
        { path: "src/cache.ts", line: 2, side: "LEFT", body: "Why drop includes()?" },
      ],
    });
    expect(await session()).toMatchObject({ status: "submitted", decision: "changes_requested" });
  });

  it("records nothing when GitHub rejects the review, and says why", async () => {
    const { post, session } = await setup();
    vi.mocked(github.submitGitHubReview).mockRejectedValueOnce(new Error("Can not approve your own pull request"));

    const res = await post("/github-review", { event: "APPROVE" });

    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Can not approve your own pull request");
    expect((await session()).status).not.toBe("submitted");
  });

  it("401s with instructions when there is no GitHub token", async () => {
    const { post } = await setup();
    vi.mocked(github.resolveGitHubToken).mockImplementationOnce(() => {
      throw new Error("GitHub token not found");
    });

    const res = await post("/github-review", { event: "APPROVE" });

    expect(res.status).toBe(401);
    expect(github.submitGitHubReview).not.toHaveBeenCalled();
  });

  it("refuses a review that isn't of a pull request", async () => {
    const { post } = await setup({ title: "Local changes" });
    const res = await post("/github-review", { event: "APPROVE" });
    expect(res.status).toBe(400);
  });

  it("rejects an agent's thread — only the reviewer's own words go out under their name", async () => {
    const { post, thread } = await setup();
    const agentThread = await thread({ body: "finding", author: "agent", type: "finding" });
    const res = await post("/github-review", { event: "APPROVE", threadIds: [agentThread] });
    expect(res.status).toBe(400);
    expect(github.submitGitHubReview).not.toHaveBeenCalled();
  });

  it("rejects an unknown side on a thread", async () => {
    const { post } = await setup();
    const res = await post("/annotations", {
      file: "a.ts", line: 1, side: "left", body: "x", type: "question", source: { agent: "reviewer" },
    });
    expect(res.status).toBe(400);
  });
});

describe("reusing an open dashboard tab (#188)", () => {
  beforeEach(() => {
    vi.mocked(git.getRepoRoot).mockReturnValue(null);
    vi.mocked(open).mockClear();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function review(baseUrl: string, projectPath: string) {
    await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: makePayload(), projectPath }),
    });
  }

  it("serves the dashboard on its preferred port, so an open tab's address survives a restart", async () => {
    // Found with node:net, not get-port: get-port locks a port it hands out,
    // and the server would then skip it.
    const uiPort = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    handle = await startGlobalServer({ silent: true, openBrowser: false, uiPort });
    const status = (await (await fetch(`http://localhost:${handle.httpPort}/api/status`)).json()) as { uiUrl: string };
    expect(status.uiUrl).toContain(`http://localhost:${uiPort}?`);
  });

  it("gives an open dashboard time to reconnect before opening a new tab", async () => {
    handle = await startGlobalServer({ silent: true, openBrowser: false, reconnectGraceMs: 400 });
    await review(`http://localhost:${handle.httpPort}`, "/restarted");

    // The tab from before the restart reconnects inside the grace period.
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`ws://localhost:${handle.wsPort}`);
    await new Promise((resolve) => ws.once("open", resolve));
    await sleep(600);

    expect(open).not.toHaveBeenCalled();
    ws.close();
  });

  it("opens a tab once the grace period passes with nobody watching", async () => {
    handle = await startGlobalServer({ silent: true, openBrowser: false, reconnectGraceMs: 200 });
    await review(`http://localhost:${handle.httpPort}`, "/unwatched");

    expect(open).not.toHaveBeenCalled();
    await sleep(400);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens a tab straight away when the server has long been up and nobody is watching", async () => {
    handle = await startGlobalServer({ silent: true, openBrowser: false, reconnectGraceMs: 0 });
    await review(`http://localhost:${handle.httpPort}`, "/idle");
    expect(open).toHaveBeenCalledTimes(1);
  });
});
