import type { Annotation, ReviewCaller, ReviewDecision } from "../types";
import { awaitingAgent } from "./threads";

// ─── Where a local review stands (#204, #274, #269) ───
//
// One line above the decision buttons says who the review is waiting on:
// the reviewer (a commit is blocked until they decide), the agent (it has
// findings to fix, so there's nothing to decide yet), or nobody (decided).
// Everything here is read off state the page already has: the session's
// caller and decision, and the threads.

export type StatusTone = "waiting-on-you" | "waiting-on-agent" | "decided" | "stale";

export interface ReviewStatusLine {
  tone: StatusTone;
  text: string;
  /** A countdown to show after the text, when something waits until a time. */
  until?: number;
}

/** What each caller is, in words. */
const CALLER_NAME: Record<ReviewCaller["kind"], string> = {
  commit: "A git commit",
  review: "`diffprism review`",
  agent: "An agent",
};

const DECIDED: Partial<Record<ReviewDecision, string>> = {
  approved: "You approved this change.",
  approved_with_comments: "You approved this change, with comments.",
  changes_requested:
    "You requested changes. The agent gets your comments, and its next round of fixes comes back here as a new round.",
};

/**
 * A thread the agent has answered with a fix, after the reviewer sent it, and
 * since their last decision. Threads outlive rounds, and a fix the reviewer
 * already judged isn't news.
 */
function fixedByAgent(thread: Annotation, decidedAt: number | undefined): boolean {
  const replies = thread.replies ?? [];
  const latest = replies.at(-1);
  return (
    !thread.dismissed &&
    replies.some((r) => r.author === "reviewer") &&
    latest?.author === "agent" &&
    !!latest.fixed &&
    (decidedAt === undefined || latest.createdAt > decidedAt)
  );
}

export function reviewStatus(input: {
  caller?: ReviewCaller;
  decision?: ReviewDecision;
  /** When the reviewer last decided; fixes before it belong to an earlier round. */
  decidedAt?: number;
  annotations: Annotation[];
}): ReviewStatusLine[] {
  const { caller, decision, decidedAt, annotations } = input;
  const lines: ReviewStatusLine[] = [];

  // A decision stands until the change comes back as a new round (#269).
  const decided = decision ? DECIDED[decision] : undefined;
  if (decided) return [{ tone: "decided", text: decided }];

  // Findings and questions out with the agent (#274): nothing to decide yet.
  // Everything the reviewer is waiting on the agent for: findings sent to be
  // fixed, and questions to be answered alike.
  const outstanding = annotations.filter(awaitingAgent).length;
  const fixed = annotations.filter((t) => fixedByAgent(t, decidedAt)).length;
  if (outstanding > 0) {
    const sent = `${outstanding} ${outstanding === 1 ? "is" : "are"} with the agent`;
    const soFar = fixed > 0 ? `, ${fixed} fixed so far` : "";
    lines.push({
      tone: "waiting-on-agent",
      text: `${sent}${soFar}. It fixes each finding without committing and marks it Fixed, or answers. No need to request changes for that — wait for it, then decide.`,
    });
  } else if (fixed > 0) {
    lines.push({
      tone: "waiting-on-you",
      text: `The agent is back: ${fixed} fixed. Check the fixes, then decide.`,
    });
  }

  // What is blocked on the decision (#204). While the agent has work, the
  // agent's line is the whole story: its wait ended on purpose (a caller's
  // `waiting` can lag by a few seconds), so neither "waiting on you" nor
  // "stopped waiting" would be true.
  if (outstanding > 0) return lines;
  if (caller?.waiting) {
    const blocked = caller.kind === "commit" ? "Approve to let it through, or Request Changes to stop it." : "Your decision goes back to it.";
    lines.push({
      tone: "waiting-on-you",
      text: `${CALLER_NAME[caller.kind]} is waiting on this review. ${blocked}`,
      until: caller.until,
    });
  } else if (caller) {
    const again = caller.kind === "commit" ? "run git commit again" : caller.kind === "review" ? "run diffprism review again" : "the agent asks again";
    lines.push({
      tone: "stale",
      text: `${CALLER_NAME[caller.kind]} stopped waiting. Your decision is kept: decide here, and it's picked up when ${again}.`,
    });
  }

  return lines;
}
