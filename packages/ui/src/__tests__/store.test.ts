// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useReviewStore } from "../store/review.js";
import type { ReviewInitPayload, ReviewComment, SessionSummary } from "../types.js";

function makeInitPayload(fileCount = 2): ReviewInitPayload {
  return {
    reviewId: "review-123",
    diffSet: {
      baseRef: "HEAD",
      headRef: "staged",
      files: Array.from({ length: fileCount }, (_, i) => ({
        path: `src/file${i}.ts`,
        status: "modified" as const,
        hunks: [],
        language: "typescript",
        binary: false,
        additions: 3,
        deletions: 1,
      })),
    },
    rawDiff: "diff --git a/file b/file",
    briefing: {
      summary: "2 files changed",
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
    },
    metadata: { title: "Test review" },
  };
}

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    file: "src/file0.ts",
    line: 10,
    body: "Consider renaming this",
    type: "suggestion",
    ...overrides,
  };
}

describe("review store", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store to initial state
    useReviewStore.setState({
      reviewId: null,
      diffSet: null,
      rawDiff: null,
      briefing: null,
      metadata: null,
      selectedFile: null,
      connectionStatus: "connecting",
      viewMode: "unified",
      fileStatuses: {},
      comments: [],
      activeCommentKey: null,
      theme: "dark",
      isWatchMode: false,
      watchSubmitted: false,
      hasUnreviewedChanges: true,
      isServerMode: false,
      sessions: [],
      activeSessionId: null,
    });
  });

  describe("initReview", () => {
    it("sets all review data from payload", () => {
      const payload = makeInitPayload();
      useReviewStore.getState().initReview(payload);

      const state = useReviewStore.getState();
      expect(state.reviewId).toBe("review-123");
      expect(state.diffSet).toBe(payload.diffSet);
      expect(state.rawDiff).toBe(payload.rawDiff);
      expect(state.briefing).toBe(payload.briefing);
      expect(state.metadata).toBe(payload.metadata);
    });

    it("selects the first file automatically", () => {
      useReviewStore.getState().initReview(makeInitPayload());
      expect(useReviewStore.getState().selectedFile).toBe("src/file0.ts");
    });

    it("sets selectedFile to null when there are no files", () => {
      useReviewStore.getState().initReview(makeInitPayload(0));
      expect(useReviewStore.getState().selectedFile).toBeNull();
    });

    it("initializes all file statuses to unreviewed", () => {
      useReviewStore.getState().initReview(makeInitPayload(3));
      const statuses = useReviewStore.getState().fileStatuses;
      expect(Object.keys(statuses)).toHaveLength(3);
      expect(statuses["src/file0.ts"]).toBe("unreviewed");
      expect(statuses["src/file1.ts"]).toBe("unreviewed");
      expect(statuses["src/file2.ts"]).toBe("unreviewed");
    });

    it("resets comments and activeCommentKey", () => {
      // Add a comment first
      useReviewStore.getState().addComment(makeComment());
      useReviewStore.getState().setActiveCommentKey("some-key");

      // Init should clear them
      useReviewStore.getState().initReview(makeInitPayload());
      expect(useReviewStore.getState().comments).toEqual([]);
      expect(useReviewStore.getState().activeCommentKey).toBeNull();
    });
  });

  describe("selectFile", () => {
    it("updates the selected file", () => {
      useReviewStore.getState().selectFile("src/other.ts");
      expect(useReviewStore.getState().selectedFile).toBe("src/other.ts");
    });
  });

  describe("setConnectionStatus", () => {
    it("updates connection status", () => {
      useReviewStore.getState().setConnectionStatus("connected");
      expect(useReviewStore.getState().connectionStatus).toBe("connected");

      useReviewStore.getState().setConnectionStatus("disconnected");
      expect(useReviewStore.getState().connectionStatus).toBe("disconnected");
    });
  });

  describe("setViewMode", () => {
    it("switches between unified and split", () => {
      useReviewStore.getState().setViewMode("split");
      expect(useReviewStore.getState().viewMode).toBe("split");

      useReviewStore.getState().setViewMode("unified");
      expect(useReviewStore.getState().viewMode).toBe("unified");
    });
  });

  describe("setFileStatus", () => {
    it("sets the status for a specific file", () => {
      useReviewStore.getState().initReview(makeInitPayload());
      useReviewStore.getState().setFileStatus("src/file0.ts", "approved");
      expect(useReviewStore.getState().fileStatuses["src/file0.ts"]).toBe("approved");
    });

    it("does not affect other files", () => {
      useReviewStore.getState().initReview(makeInitPayload());
      useReviewStore.getState().setFileStatus("src/file0.ts", "approved");
      expect(useReviewStore.getState().fileStatuses["src/file1.ts"]).toBe("unreviewed");
    });
  });

  describe("cycleFileStatus", () => {
    it("cycles through unreviewed → reviewed → approved → needs_changes → unreviewed", () => {
      useReviewStore.getState().initReview(makeInitPayload());
      const cycle = useReviewStore.getState().cycleFileStatus;
      const path = "src/file0.ts";

      expect(useReviewStore.getState().fileStatuses[path]).toBe("unreviewed");

      cycle(path);
      expect(useReviewStore.getState().fileStatuses[path]).toBe("reviewed");

      cycle(path);
      expect(useReviewStore.getState().fileStatuses[path]).toBe("approved");

      cycle(path);
      expect(useReviewStore.getState().fileStatuses[path]).toBe("needs_changes");

      cycle(path);
      expect(useReviewStore.getState().fileStatuses[path]).toBe("unreviewed");
    });

    it("defaults to unreviewed for unknown files and cycles forward", () => {
      useReviewStore.getState().cycleFileStatus("unknown.ts");
      expect(useReviewStore.getState().fileStatuses["unknown.ts"]).toBe("reviewed");
    });
  });

  describe("comments", () => {
    it("addComment appends to the list", () => {
      const c1 = makeComment({ body: "First" });
      const c2 = makeComment({ body: "Second", line: 20 });

      useReviewStore.getState().addComment(c1);
      useReviewStore.getState().addComment(c2);

      const comments = useReviewStore.getState().comments;
      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe("First");
      expect(comments[1].body).toBe("Second");
    });

    it("updateComment replaces the comment at the given index", () => {
      useReviewStore.getState().addComment(makeComment({ body: "Original" }));
      useReviewStore.getState().addComment(makeComment({ body: "Keep me" }));

      useReviewStore.getState().updateComment(0, makeComment({ body: "Updated" }));

      const comments = useReviewStore.getState().comments;
      expect(comments[0].body).toBe("Updated");
      expect(comments[1].body).toBe("Keep me");
    });

    it("deleteComment removes the comment at the given index", () => {
      useReviewStore.getState().addComment(makeComment({ body: "A" }));
      useReviewStore.getState().addComment(makeComment({ body: "B" }));
      useReviewStore.getState().addComment(makeComment({ body: "C" }));

      useReviewStore.getState().deleteComment(1);

      const comments = useReviewStore.getState().comments;
      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe("A");
      expect(comments[1].body).toBe("C");
    });
  });

  describe("setActiveCommentKey", () => {
    it("sets and clears the active comment key", () => {
      useReviewStore.getState().setActiveCommentKey("file0:10");
      expect(useReviewStore.getState().activeCommentKey).toBe("file0:10");

      useReviewStore.getState().setActiveCommentKey(null);
      expect(useReviewStore.getState().activeCommentKey).toBeNull();
    });
  });

  describe("toggleTheme", () => {
    it("toggles from dark to light", () => {
      useReviewStore.getState().toggleTheme();
      expect(useReviewStore.getState().theme).toBe("light");
      expect(localStorage.getItem("diffprism-theme")).toBe("light");
    });

    it("toggles from light back to dark", () => {
      useReviewStore.getState().toggleTheme(); // dark → light
      useReviewStore.getState().toggleTheme(); // light → dark
      expect(useReviewStore.getState().theme).toBe("dark");
      expect(localStorage.getItem("diffprism-theme")).toBe("dark");
    });
  });

  describe("session management", () => {
    function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
      return {
        id: "session-abc",
        projectPath: "/test/project",
        branch: "main",
        title: "Test review",
        fileCount: 3,
        additions: 10,
        deletions: 5,
        status: "pending",
        createdAt: Date.now(),
        ...overrides,
      };
    }

    it("setServerMode enables server mode", () => {
      useReviewStore.getState().setServerMode(true);
      expect(useReviewStore.getState().isServerMode).toBe(true);
    });

    it("setSessions replaces the session list", () => {
      const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" })];
      useReviewStore.getState().setSessions(sessions);
      expect(useReviewStore.getState().sessions).toHaveLength(2);
      expect(useReviewStore.getState().sessions[0].id).toBe("s1");
    });

    it("addSession appends to the session list", () => {
      useReviewStore.getState().setSessions([makeSession({ id: "s1" })]);
      useReviewStore.getState().addSession(makeSession({ id: "s2" }));
      expect(useReviewStore.getState().sessions).toHaveLength(2);
      expect(useReviewStore.getState().sessions[1].id).toBe("s2");
    });

    it("addSession deduplicates by session ID", () => {
      useReviewStore.getState().setSessions([makeSession({ id: "s1" })]);
      useReviewStore.getState().addSession(makeSession({ id: "s1", title: "Duplicate" }));
      expect(useReviewStore.getState().sessions).toHaveLength(1);
    });

    it("updateSession updates an existing session's status", () => {
      useReviewStore.getState().setSessions([
        makeSession({ id: "s1", status: "pending" }),
        makeSession({ id: "s2", status: "pending" }),
      ]);
      useReviewStore.getState().updateSession(makeSession({ id: "s1", status: "in_review" }));
      expect(useReviewStore.getState().sessions[0].status).toBe("in_review");
      expect(useReviewStore.getState().sessions[1].status).toBe("pending");
    });

    it("updateSession is a no-op for unknown ID", () => {
      useReviewStore.getState().setSessions([makeSession({ id: "s1" })]);
      useReviewStore.getState().updateSession(makeSession({ id: "unknown" }));
      expect(useReviewStore.getState().sessions).toHaveLength(1);
      expect(useReviewStore.getState().sessions[0].id).toBe("s1");
    });

    it("removeSession removes from list", () => {
      useReviewStore.getState().setSessions([
        makeSession({ id: "s1" }),
        makeSession({ id: "s2" }),
      ]);
      useReviewStore.getState().removeSession("s1");
      expect(useReviewStore.getState().sessions).toHaveLength(1);
      expect(useReviewStore.getState().sessions[0].id).toBe("s2");
    });

    it("removeSession clears active review when active session is removed", () => {
      useReviewStore.getState().initReview(makeInitPayload());
      useReviewStore.getState().setSessions([makeSession({ id: "review-123" })]);
      // activeSessionId is set by initReview to "review-123"
      expect(useReviewStore.getState().activeSessionId).toBe("review-123");

      useReviewStore.getState().removeSession("review-123");
      expect(useReviewStore.getState().activeSessionId).toBeNull();
      expect(useReviewStore.getState().diffSet).toBeNull();
      expect(useReviewStore.getState().briefing).toBeNull();
      expect(useReviewStore.getState().metadata).toBeNull();
    });

    it("removeSession does not clear review for non-active session", () => {
      useReviewStore.getState().initReview(makeInitPayload());
      useReviewStore.getState().setSessions([
        makeSession({ id: "review-123" }),
        makeSession({ id: "other-session" }),
      ]);

      useReviewStore.getState().removeSession("other-session");
      // Review state should be preserved
      expect(useReviewStore.getState().activeSessionId).toBe("review-123");
      expect(useReviewStore.getState().diffSet).not.toBeNull();
      expect(useReviewStore.getState().sessions).toHaveLength(1);
    });

    it("selectSession sets the active session ID", () => {
      useReviewStore.getState().selectSession("session-xyz");
      expect(useReviewStore.getState().activeSessionId).toBe("session-xyz");
    });

    it("initReview sets activeSessionId to the review ID", () => {
      useReviewStore.getState().initReview(makeInitPayload());
      expect(useReviewStore.getState().activeSessionId).toBe("review-123");
    });

    it("updateSession replaces the matching session in the array", () => {
      const sessions = [
        makeSession({ id: "s1", status: "pending" }),
        makeSession({ id: "s2", status: "pending" }),
        makeSession({ id: "s3", status: "pending" }),
      ];
      useReviewStore.getState().setSessions(sessions);

      useReviewStore.getState().updateSession(
        makeSession({ id: "s2", status: "submitted", decision: "approved" }),
      );

      const updated = useReviewStore.getState().sessions;
      expect(updated).toHaveLength(3);
      expect(updated[0].id).toBe("s1");
      expect(updated[0].status).toBe("pending");
      expect(updated[1].id).toBe("s2");
      expect(updated[1].status).toBe("submitted");
      expect(updated[1].decision).toBe("approved");
      expect(updated[2].id).toBe("s3");
      expect(updated[2].status).toBe("pending");
    });

    it("updateSession is a no-op when session ID does not exist", () => {
      const sessions = [makeSession({ id: "s1" })];
      useReviewStore.getState().setSessions(sessions);

      useReviewStore.getState().updateSession(makeSession({ id: "nonexistent" }));

      expect(useReviewStore.getState().sessions).toHaveLength(1);
      expect(useReviewStore.getState().sessions[0].id).toBe("s1");
    });
  });
});
