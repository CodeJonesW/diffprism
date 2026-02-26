import type { DiffSet, DiffFile } from "@diffprism/core";
import { getGitDiff } from "./local.js";
import { parseDiff } from "./parser.js";

export { getGitDiff, getCurrentBranch, listBranches, listCommits } from "./local.js";
export { parseDiff } from "./parser.js";

/**
 * High-level API: run `git diff` for the given ref and return both the
 * raw diff text and the parsed `DiffSet`.
 *
 * @param ref - One of "staged", "unstaged", "working-copy", or an arbitrary git range (e.g. "HEAD~3..HEAD").
 * @param options.cwd - Working directory.  Defaults to process.cwd().
 */
export function getDiff(
  ref: string,
  options?: { cwd?: string },
): { diffSet: DiffSet; rawDiff: string } {
  if (ref === "working-copy") {
    return getWorkingCopyDiff(options);
  }

  const rawDiff = getGitDiff(ref, options);

  // Derive baseRef / headRef labels from the ref string
  let baseRef: string;
  let headRef: string;

  if (ref === "staged") {
    baseRef = "HEAD";
    headRef = "staged";
  } else if (ref === "unstaged") {
    baseRef = "staged";
    headRef = "working tree";
  } else if (ref.includes("..")) {
    const [base, head] = ref.split("..");
    baseRef = base;
    headRef = head;
  } else {
    baseRef = ref;
    headRef = "HEAD";
  }

  const diffSet = parseDiff(rawDiff, baseRef, headRef);
  return { diffSet, rawDiff };
}

/**
 * Run staged and unstaged diffs separately, tag each file with its stage,
 * and merge into a single DiffSet. This preserves the distinction between
 * staged and unstaged changes (even for the same file).
 */
function getWorkingCopyDiff(
  options?: { cwd?: string },
): { diffSet: DiffSet; rawDiff: string } {
  const stagedRaw = getGitDiff("staged", options);
  const unstagedRaw = getGitDiff("unstaged", options);

  const stagedDiffSet = parseDiff(stagedRaw, "HEAD", "staged");
  const unstagedDiffSet = parseDiff(unstagedRaw, "staged", "working tree");

  const stagedFiles: DiffFile[] = stagedDiffSet.files.map((f) => ({
    ...f,
    stage: "staged" as const,
  }));

  const unstagedFiles: DiffFile[] = unstagedDiffSet.files.map((f) => ({
    ...f,
    stage: "unstaged" as const,
  }));

  const rawDiff = [stagedRaw, unstagedRaw].filter(Boolean).join("");

  return {
    diffSet: {
      baseRef: "HEAD",
      headRef: "working tree",
      files: [...stagedFiles, ...unstagedFiles],
    },
    rawDiff,
  };
}
