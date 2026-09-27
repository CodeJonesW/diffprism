/**
 * Which diff a review shows, decided in one place.
 *
 * Scope rides on a single `diff_ref` string, and each entry point used to
 * pick its own default: CLI `review` and the dashboard showed the working
 * copy, while MCP `open_review` had no default at all. The same "review my
 * changes" request reviewed different things depending on how it was made.
 */

/**
 * The default for every interactive review — CLI `review`, the dashboard's
 * Open Project, MCP `open_review`, and the headless `get_diff`/`analyze_diff`
 * an agent runs before opening one. Self-review and the human review it leads
 * to have to look at the same diff.
 *
 * The UI cannot import this (Vite does not resolve workspace packages at
 * runtime), so rather than keep a copy that can drift, it reads the default
 * from GET /api/status and asks the server to reset a comparison.
 */
export const DEFAULT_DIFF_REF = "working-copy";

/**
 * The pre-commit gate reviews only what is staged — deliberately different.
 * A commit contains the index and nothing else, so an unstaged edit is not
 * part of what is being approved; showing it would ask the reviewer to judge
 * code the commit does not include.
 */
export const COMMIT_GATE_DIFF_REF = "staged";

/** The one description of the scopes, used wherever a `diff_ref` is accepted. */
export const DIFF_REF_DESCRIPTION =
  'Which changes to review. "working-copy" (the default): everything not yet committed, staged and unstaged shown as separate groups. "staged": only what the next commit would contain. "unstaged": only edits not yet staged. Or a ref range such as "HEAD~3..HEAD" or "main..feature".';

/**
 * Where the new side of a diff lives: the version of each file someone
 * reviewing that diff is judging. Reading any other version misjudges the
 * change. For a staged review, HEAD is the code from before it, and the
 * working tree may hold edits the commit leaves out.
 *
 * - `index`: what is staged ("staged").
 * - `commit`: a revision, the right end of a range such as "main..feature".
 * - `working-tree`: the files on disk ("working-copy", "unstaged", or a single
 *   ref, which git diffs against the working tree).
 */
export type DiffNewSide = { kind: "index" } | { kind: "commit"; ref: string } | { kind: "working-tree" };

export function diffNewSide(diffRef: string): DiffNewSide {
  if (diffRef === COMMIT_GATE_DIFF_REF) return { kind: "index" };
  const range = diffRef.match(/^.*?\.\.\.?(.*)$/);
  if (range) return { kind: "commit", ref: range[1] || "HEAD" };
  return { kind: "working-tree" };
}
