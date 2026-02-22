import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { WatchFileInfo, ReviewResult, ReviewResultFile } from "./types.js";

function findGitRoot(cwd?: string): string {
  const root = execSync("git rev-parse --show-toplevel", {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
  }).trim();
  return root;
}

function watchFilePath(cwd?: string): string {
  const gitRoot = findGitRoot(cwd);
  return path.join(gitRoot, ".diffprism", "watch.json");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function writeWatchFile(cwd: string | undefined, info: WatchFileInfo): void {
  const filePath = watchFilePath(cwd);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(info, null, 2) + "\n");
}

export function readWatchFile(cwd?: string): WatchFileInfo | null {
  const filePath = watchFilePath(cwd);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const info = JSON.parse(raw) as WatchFileInfo;

    // Verify the process is still alive
    if (!isPidAlive(info.pid)) {
      // Clean up stale file
      fs.unlinkSync(filePath);
      return null;
    }

    return info;
  } catch {
    return null;
  }
}

export function removeWatchFile(cwd?: string): void {
  try {
    const filePath = watchFilePath(cwd);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

// ─── Review Result File ───

function reviewResultPath(cwd?: string): string {
  const gitRoot = findGitRoot(cwd);
  return path.join(gitRoot, ".diffprism", "last-review.json");
}

export function writeReviewResult(cwd: string | undefined, result: ReviewResult): void {
  const filePath = reviewResultPath(cwd);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data: ReviewResultFile = {
    result,
    timestamp: Date.now(),
    consumed: false,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

export function readReviewResult(cwd?: string): ReviewResultFile | null {
  try {
    const filePath = reviewResultPath(cwd);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as ReviewResultFile;
    if (data.consumed) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function consumeReviewResult(cwd?: string): void {
  try {
    const filePath = reviewResultPath(cwd);
    if (!fs.existsSync(filePath)) {
      return;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as ReviewResultFile;
    data.consumed = true;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  } catch {
    // Ignore errors
  }
}
