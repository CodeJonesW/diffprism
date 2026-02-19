import type { DiffSet } from "@diffprism/core";
import { getGitDiff } from "./local.js";
import { parseDiff } from "./parser.js";

export { getGitDiff, getCurrentBranch } from "./local.js";
export { parseDiff } from "./parser.js";

/**
 * High-level API: run `git diff` for the given ref and return both the
 * raw diff text and the parsed `DiffSet`.
 *
 * @param ref - One of "staged", "unstaged", or an arbitrary git range (e.g. "HEAD~3..HEAD").
 * @param options.cwd - Working directory.  Defaults to process.cwd().
 */
export function getDiff(
  ref: string,
  options?: { cwd?: string },
): { diffSet: DiffSet; rawDiff: string } {
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
