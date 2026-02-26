import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ReviewHistoryEntry {
  id: string;
  timestamp: number;
  diffRef: string;
  decision: string;
  filesReviewed: number;
  additions: number;
  deletions: number;
  commentCount: number;
  branch?: string;
  title?: string;
  summary?: string;
}

export interface ReviewHistory {
  version: 1;
  entries: ReviewHistoryEntry[];
}

/**
 * Generate a unique ID for a review history entry.
 */
export function generateEntryId(): string {
  return randomUUID();
}

/**
 * Get the history file path for a given project directory.
 */
export function getHistoryPath(projectDir: string): string {
  return path.join(projectDir, ".diffprism", "history", "reviews.json");
}

/**
 * Read review history for a project. Returns empty history if file doesn't exist.
 */
export function readHistory(projectDir: string): ReviewHistory {
  const filePath = getHistoryPath(projectDir);
  if (!fs.existsSync(filePath)) {
    return { version: 1, entries: [] };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ReviewHistory;
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

/**
 * Append a review entry to the project's history.
 * Creates directories if needed. Keeps entries sorted by timestamp.
 */
export function appendHistory(
  projectDir: string,
  entry: ReviewHistoryEntry,
): void {
  const filePath = getHistoryPath(projectDir);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const history = readHistory(projectDir);
  history.entries.push(entry);
  history.entries.sort((a, b) => a.timestamp - b.timestamp);

  fs.writeFileSync(filePath, JSON.stringify(history, null, 2) + "\n");
}

/**
 * Get recent review history (last N entries).
 * Entries are returned in chronological order (oldest first).
 */
export function getRecentHistory(
  projectDir: string,
  limit: number = 50,
): ReviewHistoryEntry[] {
  const history = readHistory(projectDir);
  return history.entries.slice(-limit);
}

/**
 * Get review stats for a project.
 */
export function getHistoryStats(projectDir: string): {
  totalReviews: number;
  approvedCount: number;
  changesRequestedCount: number;
  avgCommentsPerReview: number;
  lastReviewDate: number | null;
} {
  const history = readHistory(projectDir);
  const entries = history.entries;

  if (entries.length === 0) {
    return {
      totalReviews: 0,
      approvedCount: 0,
      changesRequestedCount: 0,
      avgCommentsPerReview: 0,
      lastReviewDate: null,
    };
  }

  const approvedCount = entries.filter(
    (e) => e.decision === "approved" || e.decision === "approved_with_comments",
  ).length;

  const changesRequestedCount = entries.filter(
    (e) => e.decision === "changes_requested",
  ).length;

  const totalComments = entries.reduce((sum, e) => sum + e.commentCount, 0);
  const avgCommentsPerReview = totalComments / entries.length;

  const lastReviewDate = entries[entries.length - 1].timestamp;

  return {
    totalReviews: entries.length,
    approvedCount,
    changesRequestedCount,
    avgCommentsPerReview,
    lastReviewDate,
  };
}
