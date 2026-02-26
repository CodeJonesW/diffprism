import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readHistory,
  appendHistory,
  getRecentHistory,
  getHistoryStats,
  getHistoryPath,
  generateEntryId,
} from "../review-history.js";
import type { ReviewHistoryEntry } from "../review-history.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diffprism-history-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<ReviewHistoryEntry> = {}): ReviewHistoryEntry {
  return {
    id: generateEntryId(),
    timestamp: Date.now(),
    diffRef: "staged",
    decision: "approved",
    filesReviewed: 3,
    additions: 50,
    deletions: 10,
    commentCount: 0,
    ...overrides,
  };
}

describe("review-history", () => {
  describe("getHistoryPath", () => {
    it("returns the correct path", () => {
      const result = getHistoryPath("/some/project");
      expect(result).toBe(
        path.join("/some/project", ".diffprism", "history", "reviews.json"),
      );
    });
  });

  describe("generateEntryId", () => {
    it("returns a valid UUID string", () => {
      const id = generateEntryId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("returns unique values", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateEntryId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("readHistory", () => {
    it("returns empty history for non-existent file", () => {
      const history = readHistory(tmpDir);
      expect(history).toEqual({ version: 1, entries: [] });
    });

    it("returns empty history for corrupted file", () => {
      const filePath = getHistoryPath(tmpDir);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "not valid json{{{");

      const history = readHistory(tmpDir);
      expect(history).toEqual({ version: 1, entries: [] });
    });
  });

  describe("appendHistory", () => {
    it("creates the directory and file on first append", () => {
      const entry = makeEntry();
      appendHistory(tmpDir, entry);

      const filePath = getHistoryPath(tmpDir);
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(1);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].id).toBe(entry.id);
    });

    it("adds entries that persist on readHistory", () => {
      const entry1 = makeEntry({ timestamp: 1000, decision: "approved" });
      const entry2 = makeEntry({ timestamp: 2000, decision: "changes_requested" });

      appendHistory(tmpDir, entry1);
      appendHistory(tmpDir, entry2);

      const history = readHistory(tmpDir);
      expect(history.entries).toHaveLength(2);
      expect(history.entries[0].id).toBe(entry1.id);
      expect(history.entries[1].id).toBe(entry2.id);
    });

    it("keeps entries sorted by timestamp", () => {
      const entry1 = makeEntry({ timestamp: 3000 });
      const entry2 = makeEntry({ timestamp: 1000 });
      const entry3 = makeEntry({ timestamp: 2000 });

      appendHistory(tmpDir, entry1);
      appendHistory(tmpDir, entry2);
      appendHistory(tmpDir, entry3);

      const history = readHistory(tmpDir);
      expect(history.entries[0].timestamp).toBe(1000);
      expect(history.entries[1].timestamp).toBe(2000);
      expect(history.entries[2].timestamp).toBe(3000);
    });

    it("preserves optional fields", () => {
      const entry = makeEntry({
        branch: "feature/test",
        title: "Add new feature",
        summary: "This is a test summary",
      });

      appendHistory(tmpDir, entry);

      const history = readHistory(tmpDir);
      expect(history.entries[0].branch).toBe("feature/test");
      expect(history.entries[0].title).toBe("Add new feature");
      expect(history.entries[0].summary).toBe("This is a test summary");
    });
  });

  describe("getRecentHistory", () => {
    it("returns empty array for non-existent history", () => {
      const recent = getRecentHistory(tmpDir);
      expect(recent).toEqual([]);
    });

    it("returns all entries when fewer than limit", () => {
      appendHistory(tmpDir, makeEntry({ timestamp: 1000 }));
      appendHistory(tmpDir, makeEntry({ timestamp: 2000 }));

      const recent = getRecentHistory(tmpDir, 50);
      expect(recent).toHaveLength(2);
    });

    it("returns last N entries when more than limit", () => {
      for (let i = 0; i < 10; i++) {
        appendHistory(tmpDir, makeEntry({ timestamp: i * 1000 }));
      }

      const recent = getRecentHistory(tmpDir, 3);
      expect(recent).toHaveLength(3);
      expect(recent[0].timestamp).toBe(7000);
      expect(recent[1].timestamp).toBe(8000);
      expect(recent[2].timestamp).toBe(9000);
    });

    it("defaults to 50 entries", () => {
      for (let i = 0; i < 60; i++) {
        appendHistory(tmpDir, makeEntry({ timestamp: i * 1000 }));
      }

      const recent = getRecentHistory(tmpDir);
      expect(recent).toHaveLength(50);
      // Should be the last 50 entries (timestamps 10000..59000)
      expect(recent[0].timestamp).toBe(10000);
      expect(recent[49].timestamp).toBe(59000);
    });
  });

  describe("getHistoryStats", () => {
    it("returns zeros for empty history", () => {
      const stats = getHistoryStats(tmpDir);
      expect(stats).toEqual({
        totalReviews: 0,
        approvedCount: 0,
        changesRequestedCount: 0,
        avgCommentsPerReview: 0,
        lastReviewDate: null,
      });
    });

    it("computes correct aggregate stats", () => {
      appendHistory(
        tmpDir,
        makeEntry({
          timestamp: 1000,
          decision: "approved",
          commentCount: 0,
        }),
      );
      appendHistory(
        tmpDir,
        makeEntry({
          timestamp: 2000,
          decision: "changes_requested",
          commentCount: 5,
        }),
      );
      appendHistory(
        tmpDir,
        makeEntry({
          timestamp: 3000,
          decision: "approved_with_comments",
          commentCount: 2,
        }),
      );
      appendHistory(
        tmpDir,
        makeEntry({
          timestamp: 4000,
          decision: "dismissed",
          commentCount: 1,
        }),
      );

      const stats = getHistoryStats(tmpDir);
      expect(stats.totalReviews).toBe(4);
      expect(stats.approvedCount).toBe(2); // "approved" + "approved_with_comments"
      expect(stats.changesRequestedCount).toBe(1);
      expect(stats.avgCommentsPerReview).toBe(2); // (0 + 5 + 2 + 1) / 4
      expect(stats.lastReviewDate).toBe(4000);
    });

    it("handles single entry", () => {
      appendHistory(
        tmpDir,
        makeEntry({
          timestamp: 5000,
          decision: "approved",
          commentCount: 3,
        }),
      );

      const stats = getHistoryStats(tmpDir);
      expect(stats.totalReviews).toBe(1);
      expect(stats.approvedCount).toBe(1);
      expect(stats.changesRequestedCount).toBe(0);
      expect(stats.avgCommentsPerReview).toBe(3);
      expect(stats.lastReviewDate).toBe(5000);
    });
  });
});
