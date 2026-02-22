import type { DiffFile } from "../types";

/**
 * Get a unique key for a DiffFile. When `stage` is set (working-copy mode),
 * the key is prefixed with the stage to distinguish the same file appearing
 * in both staged and unstaged sections.
 */
export function getFileKey(file: DiffFile): string {
  return file.stage ? `${file.stage}:${file.path}` : file.path;
}

/**
 * Extract the display path from a file key (strip the stage prefix if present).
 */
export function getDisplayPath(fileKey: string): string {
  if (fileKey.startsWith("staged:")) return fileKey.slice(7);
  if (fileKey.startsWith("unstaged:")) return fileKey.slice(9);
  return fileKey;
}
