import { createHash } from "node:crypto";
import type { DiffFile, DiffSet } from "./types.js";

export function hashDiff(rawDiff: string): string {
  return createHash("sha256").update(rawDiff).digest("hex");
}

/**
 * Get a composite key for a DiffFile that includes the stage prefix
 * when present, so staged and unstaged entries for the same file
 * are tracked independently.
 */
export function fileKey(file: DiffFile): string {
  return file.stage ? `${file.stage}:${file.path}` : file.path;
}

export function detectChangedFiles(
  oldDiffSet: DiffSet | null,
  newDiffSet: DiffSet,
): string[] {
  if (!oldDiffSet) {
    return newDiffSet.files.map(fileKey);
  }

  const oldFiles = new Map(
    oldDiffSet.files.map((f) => [fileKey(f), f]),
  );

  const changed: string[] = [];
  for (const newFile of newDiffSet.files) {
    const key = fileKey(newFile);
    const oldFile = oldFiles.get(key);
    if (!oldFile) {
      // New file in the diff
      changed.push(key);
    } else if (
      oldFile.additions !== newFile.additions ||
      oldFile.deletions !== newFile.deletions
    ) {
      // Content changed
      changed.push(key);
    }
  }

  // Files that were removed from the diff
  for (const oldFile of oldDiffSet.files) {
    if (!newDiffSet.files.some((f) => fileKey(f) === fileKey(oldFile))) {
      changed.push(fileKey(oldFile));
    }
  }

  return changed;
}
