import type { SessionSummary } from "../types";

// ─── Pull request or local change, and who gets the decision (#254, #250) ───
//
// A PR review and a local review of the same branch look alike, but a PR
// review's decision goes to GitHub and a local review's goes back to whatever
// is waiting on it: a git commit, `diffprism review`, or an agent. Everything
// that labels a review reads it from here, off the session summary.

export interface ReviewKind {
  kind: "pr" | "local";
  /** "Pull request #239", or "Local · staged · commit gate". */
  label: string;
  /** Who gets the decision, in a sentence. */
  destination: string;
  /**
   * Whether an agent started here could fix its findings (#279): a local
   * review of uncommitted changes, where a fix to the files shows up. The
   * server holds the same rule.
   */
  fixable: boolean;
}

/** The refs a fix to the files shows up in — mirrors the server's. */
const FIXABLE_DIFF_REFS = ["staged", "unstaged", "working-copy"];

/** A diff ref as a reviewer reads it: "staged", "working copy", or the range itself. */
export function refLabel(diffRef: string | undefined): string {
  if (diffRef === undefined || diffRef === "working-copy") return "working copy";
  return diffRef;
}

/** Where a local review came from, when something has waited on it. */
const ORIGIN: Record<NonNullable<SessionSummary["caller"]>["kind"], string> = {
  commit: "commit gate",
  review: "diffprism review",
  agent: "open_review",
};

const LOCAL_DESTINATION: Record<NonNullable<SessionSummary["caller"]>["kind"], string> = {
  commit: "Your decision and summary go back to the git commit waiting on this review, not to GitHub.",
  review: "Your decision and summary go back to `diffprism review`, which is waiting on it, not to GitHub.",
  agent: "Your decision and summary go back to the agent that asked for this review, not to GitHub.",
};

export function reviewKind(session: Pick<SessionSummary, "pr" | "diffRef" | "caller" | "source">): ReviewKind {
  if (session.pr !== undefined) {
    const number = session.pr.slice(session.pr.lastIndexOf("#"));
    return {
      kind: "pr",
      label: `Pull request ${number}`,
      destination: `Your decision goes to GitHub, as a review on ${session.pr}.`,
      fixable: false,
    };
  }
  const origin = session.caller ? ORIGIN[session.caller.kind] : session.source === "manual" ? "opened here" : undefined;
  return {
    kind: "local",
    label: ["Local", refLabel(session.diffRef), origin].filter(Boolean).join(" · "),
    destination: session.caller
      ? LOCAL_DESTINATION[session.caller.kind]
      : "Your decision stays in DiffPrism, for whatever asks for this review. Nothing goes to GitHub.",
    fixable: FIXABLE_DIFF_REFS.includes(session.diffRef ?? ""),
  };
}
