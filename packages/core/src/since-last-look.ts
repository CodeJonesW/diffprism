import { fileKey } from "./diff-utils.js";
import type { DiffSet, FileSinceLastLook, Hunk } from "./types.js";

// ─── What changed since the reviewer last looked (#265) ───
//
// A round of fixes lands as a new diff of the whole change, and the reviewer
// has to hunt for the few lines that moved. Comparing the diff they saw with
// the one now tells them: which files, which hunks, which lines.

/**
 * A hunk by the lines it adds and removes: not where it is, and not its
 * context. A fix elsewhere shifts the line numbers of the hunks below it, and
 * an edit a few lines away rewrites a hunk's context, and neither changes
 * what that hunk does.
 */
function hunkSignature(hunk: Hunk): string {
  return hunk.changes
    .filter((c) => c.type !== "context")
    .map((c) => `${c.type === "add" ? "+" : "-"}${c.content}`)
    .join("\n");
}

/** How many hunks have each signature. Identical hunks are counted, not collapsed into one. */
function signatureCounts(hunks: Hunk[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hunk of hunks) {
    const signature = hunkSignature(hunk);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return counts;
}

/**
 * The lines a hunk adds, as ranges in the new file: what a fix actually
 * wrote, not the context around it. A hunk that only deletes has none.
 */
function addedRanges(hunk: Hunk): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const change of hunk.changes) {
    if (change.type !== "add") continue;
    const last = ranges.at(-1);
    if (last && change.lineNumber === last.end + 1) last.end = change.lineNumber;
    else ranges.push({ start: change.lineNumber, end: change.lineNumber });
  }
  return ranges;
}

/**
 * The files whose part of the diff differs between `seen` and `now`, with
 * the hunks of `now` the reviewer hasn't seen. Empty when nothing changed.
 */
export function sinceLastLook(seen: DiffSet, now: DiffSet): FileSinceLastLook[] {
  const seenFiles = new Map(seen.files.map((f) => [fileKey(f), f]));
  const nowKeys = new Set(now.files.map(fileKey));
  const files: FileSinceLastLook[] = [];

  for (const file of now.files) {
    const key = fileKey(file);
    const before = seenFiles.get(key);
    // Each hunk seen before can account for one hunk now, once.
    const unmatched = signatureCounts(before?.hunks ?? []);
    const fresh: Array<{ hunk: Hunk; index: number }> = [];
    file.hunks.forEach((hunk, index) => {
      const signature = hunkSignature(hunk);
      const left = unmatched.get(signature) ?? 0;
      if (left > 0) unmatched.set(signature, left - 1);
      else fresh.push({ hunk, index });
    });
    const droppedHunks = before ? [...unmatched.values()].reduce((sum, n) => sum + n, 0) : 0;
    if (before && fresh.length === 0 && droppedHunks === 0) continue;

    const changes = fresh.flatMap(({ hunk }) => hunk.changes);
    files.push({
      key,
      path: file.path,
      status: before ? "changed" : "added",
      hunks: fresh.map(({ index }) => index),
      lines: fresh.flatMap(({ hunk }) => addedRanges(hunk)),
      additions: changes.filter((c) => c.type === "add").length,
      deletions: changes.filter((c) => c.type === "delete").length,
      droppedHunks,
    });
  }

  for (const file of seen.files) {
    const key = fileKey(file);
    if (nowKeys.has(key)) continue;
    files.push({ key, path: file.path, status: "removed", hunks: [], lines: [], additions: 0, deletions: 0, droppedHunks: file.hunks.length });
  }

  return files;
}
