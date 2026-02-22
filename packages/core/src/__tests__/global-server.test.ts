import { describe, it, expect, vi, afterEach } from "vitest";
import type {
  GlobalServerHandle,
  ReviewInitPayload,
  ReviewBriefing,
  DiffSet,
  ReviewResult,
  ContextUpdatePayload,
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

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = null;
  }
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
});
