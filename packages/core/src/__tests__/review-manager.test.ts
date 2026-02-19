import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
} from "../review-manager.js";

describe("review-manager", () => {
  // Each createSession call gets a unique ID via the internal counter,
  // so we don't need to reset module state between tests — just clean up.

  describe("createSession", () => {
    it("returns a session with a unique ID matching expected format", () => {
      const session = createSession({ diffRef: "staged" });
      expect(session.id).toMatch(/^review-\d+-\d+$/);
      expect(session.status).toBe("pending");
      expect(session.options.diffRef).toBe("staged");
      expect(session.createdAt).toBeTypeOf("number");
      expect(session.result).toBeUndefined();

      // Clean up
      deleteSession(session.id);
    });

    it("generates unique IDs across calls", () => {
      const s1 = createSession({ diffRef: "staged" });
      const s2 = createSession({ diffRef: "unstaged" });
      expect(s1.id).not.toBe(s2.id);

      deleteSession(s1.id);
      deleteSession(s2.id);
    });

    it("stores the session so getSession can retrieve it", () => {
      const session = createSession({ diffRef: "HEAD~1..HEAD" });
      const retrieved = getSession(session.id);
      expect(retrieved).toBe(session);

      deleteSession(session.id);
    });
  });

  describe("getSession", () => {
    it("returns undefined for a non-existent ID", () => {
      expect(getSession("review-nonexistent-999")).toBeUndefined();
    });
  });

  describe("updateSession", () => {
    it("updates status on an existing session", () => {
      const session = createSession({ diffRef: "staged" });
      updateSession(session.id, { status: "in_progress" });

      const retrieved = getSession(session.id);
      expect(retrieved?.status).toBe("in_progress");

      deleteSession(session.id);
    });

    it("updates result on an existing session", () => {
      const session = createSession({ diffRef: "staged" });
      const result = {
        decision: "approved" as const,
        comments: [],
        summary: "Looks good",
      };
      updateSession(session.id, { status: "completed", result });

      const retrieved = getSession(session.id);
      expect(retrieved?.status).toBe("completed");
      expect(retrieved?.result).toEqual(result);

      deleteSession(session.id);
    });

    it("does nothing for a non-existent session", () => {
      // Should not throw
      updateSession("review-nonexistent-999", { status: "completed" });
    });
  });

  describe("deleteSession", () => {
    it("removes a session so getSession returns undefined", () => {
      const session = createSession({ diffRef: "staged" });
      deleteSession(session.id);
      expect(getSession(session.id)).toBeUndefined();
    });

    it("does nothing for a non-existent session", () => {
      // Should not throw
      deleteSession("review-nonexistent-999");
    });
  });
});
