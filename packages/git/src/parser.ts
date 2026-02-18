import type { DiffSet, DiffFile, Hunk, Change } from "@diffprism/core";
import path from "node:path";

// ─── Language detection ───────────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  md: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
};

const FILENAME_MAP: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

function detectLanguage(filePath: string): string {
  const basename = path.basename(filePath);

  if (FILENAME_MAP[basename]) {
    return FILENAME_MAP[basename];
  }

  const ext = basename.includes(".")
    ? basename.slice(basename.lastIndexOf(".") + 1)
    : "";

  return EXTENSION_MAP[ext] ?? "text";
}

// ─── Diff parser ──────────────────────────────────────────────────────

/**
 * Strip the `a/` or `b/` prefix that git adds to paths, or handle
 * the special `/dev/null` path.
 */
function stripPrefix(raw: string): string {
  if (raw === "/dev/null") return raw;
  // Remove leading "a/" or "b/"
  return raw.replace(/^[ab]\//, "");
}

/**
 * Parse a unified diff string into a structured `DiffSet`.
 */
export function parseDiff(
  rawDiff: string,
  baseRef: string,
  headRef: string,
): DiffSet {
  if (!rawDiff.trim()) {
    return { baseRef, headRef, files: [] };
  }

  const files: DiffFile[] = [];
  const lines = rawDiff.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Look for the start of a file diff
    if (!lines[i].startsWith("diff --git ")) {
      i++;
      continue;
    }

    // ── File header section ──────────────────────────────────────────

    let oldPath: string | undefined;
    let newPath: string | undefined;
    let status: DiffFile["status"] = "modified";
    let binary = false;
    let renameFrom: string | undefined;
    let renameTo: string | undefined;

    // Parse "diff --git a/foo b/bar"
    const diffLine = lines[i];
    const gitPathMatch = diffLine.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (gitPathMatch) {
      oldPath = gitPathMatch[1];
      newPath = gitPathMatch[2];
    }

    i++;

    // Consume header lines until we hit the next diff, a hunk, or EOF
    while (i < lines.length && !lines[i].startsWith("diff --git ")) {
      const line = lines[i];

      if (line.startsWith("--- ")) {
        const raw = line.slice(4);
        oldPath = stripPrefix(raw);
        if (raw === "/dev/null") {
          status = "added";
        }
      } else if (line.startsWith("+++ ")) {
        const raw = line.slice(4);
        newPath = stripPrefix(raw);
        if (raw === "/dev/null") {
          status = "deleted";
        }
      } else if (line.startsWith("rename from ")) {
        renameFrom = line.slice("rename from ".length);
        status = "renamed";
      } else if (line.startsWith("rename to ")) {
        renameTo = line.slice("rename to ".length);
        status = "renamed";
      } else if (
        line.startsWith("Binary files") ||
        line === "GIT binary patch"
      ) {
        binary = true;
      }

      // If we hit a hunk header, break out to parse hunks
      if (line.startsWith("@@ ")) {
        break;
      }

      i++;
    }

    // ── Determine final paths ────────────────────────────────────────

    const filePath =
      status === "deleted"
        ? oldPath ?? newPath ?? "unknown"
        : newPath ?? oldPath ?? "unknown";

    const fileOldPath =
      status === "renamed" ? (renameFrom ?? oldPath) : oldPath;

    // ── Parse hunks ──────────────────────────────────────────────────

    const hunks: Hunk[] = [];
    let additions = 0;
    let deletions = 0;

    while (i < lines.length && !lines[i].startsWith("diff --git ")) {
      const line = lines[i];

      if (line.startsWith("@@ ")) {
        const hunkMatch = line.match(
          /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
        );
        if (!hunkMatch) {
          i++;
          continue;
        }

        const oldStart = parseInt(hunkMatch[1], 10);
        const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
        const newStart = parseInt(hunkMatch[3], 10);
        const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

        const changes: Change[] = [];
        let oldLineNum = oldStart;
        let newLineNum = newStart;

        i++;

        // Parse change lines within this hunk
        while (i < lines.length) {
          const changeLine = lines[i];

          // Stop at the next hunk header or file header
          if (
            changeLine.startsWith("@@ ") ||
            changeLine.startsWith("diff --git ")
          ) {
            break;
          }

          // Skip the "\ No newline at end of file" marker
          if (changeLine.startsWith("\\ No newline at end of file")) {
            i++;
            continue;
          }

          if (changeLine.startsWith("+")) {
            changes.push({
              type: "add",
              lineNumber: newLineNum,
              content: changeLine.slice(1),
            });
            newLineNum++;
            additions++;
          } else if (changeLine.startsWith("-")) {
            changes.push({
              type: "delete",
              lineNumber: oldLineNum,
              content: changeLine.slice(1),
            });
            oldLineNum++;
            deletions++;
          } else {
            // Context line (starts with space) or empty line
            changes.push({
              type: "context",
              lineNumber: newLineNum,
              content: changeLine.length > 0 ? changeLine.slice(1) : "",
            });
            oldLineNum++;
            newLineNum++;
          }

          i++;
        }

        hunks.push({ oldStart, oldLines, newStart, newLines, changes });
      } else {
        // Skip non-hunk lines within the file block (e.g. binary patch data)
        i++;
      }
    }

    // ── Build the DiffFile ───────────────────────────────────────────

    const diffFile: DiffFile = {
      path: filePath,
      status,
      hunks,
      language: detectLanguage(filePath),
      binary,
      additions,
      deletions,
    };

    if (status === "renamed" && fileOldPath) {
      diffFile.oldPath = fileOldPath;
    }

    files.push(diffFile);
  }

  return { baseRef, headRef, files };
}
