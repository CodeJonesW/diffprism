import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  GlobalServerHandle,
  ReviewInitPayload,
  ReviewBriefing,
  DiffSet,
  ReviewResult,
  ContextUpdatePayload,
  ServerMessage,
  SessionSummary,
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
        comments: [{ file: "src/index.ts", line: 5, body: "Fix this", type: "must_fix" }],
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

    it("dismissed review:submit via WS broadcasts session:removed", async () => {
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

      // Wait for initial session:list
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Select the session
      ws.send(JSON.stringify({ type: "session:select", payload: { sessionId } }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear messages to focus on dismiss
      messages.length = 0;

      // Submit dismissed result
      ws.send(JSON.stringify({
        type: "review:submit",
        payload: { decision: "dismissed", comments: [] },
      }));

      // Wait for broadcast
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.close();

      const removedMsg = messages.find((m) => m.type === "session:removed");
      expect(removedMsg).toBeDefined();
      expect((removedMsg!.payload as { sessionId: string }).sessionId).toBe(sessionId);

      // Ensure session:updated was NOT sent for dismissed
      const updateMsg = messages.find((m) => m.type === "session:updated");
      expect(updateMsg).toBeUndefined();
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
