import type { Annotation, ReviewCaller, ReviewDecision, ReviewFixer } from "../types";
import { awaitingAgent } from "./threads";

// ─── Where a local review stands (#204, #274, #269) ───
//
// One line above the decision buttons says who the review is waiting on:
// the reviewer (a commit is blocked until they decide), the agent (it has
// findings to fix, so there's nothing to decide yet), or nobody (decided).
// Findings sent with no agent listening say what stopped and how to get them
// to one, including starting an agent here (#279).
// Everything here is read off state the page already has: the session's
// caller and decision, and the threads.

export type StatusTone = "waiting-on-you" | "waiting-on-agent" | "decided" | "stale";

export interface ReviewStatusLine {
  tone: StatusTone;
  text: string;
  /** A countdown to show after the text, when something waits until a time. */
  until?: number;
  /** A button to offer with it: start an agent to fix the findings nothing is listening for (#279). */
  action?: "start-fixer";
}

/**
 * Findings with nothing listening for them (#279): what stopped waiting, and
 * the step that gets them to an agent again.
 */
const NOBODY_LISTENING: Record<ReviewCaller["kind"] | "none", { why: string; ask: string }> = {
  commit: { why: "the git commit that was waiting on this review stopped", ask: "ask yours to run git commit again" },
  review: { why: "`diffprism review` stopped waiting", ask: "run diffprism review again" },
  agent: { why: "the agent that opened this review stopped waiting", ask: "ask it to check the review again" },
  none: { why: "no agent is listening", ask: "ask the agent that made the change to answer your DiffPrism comments" },
};

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
  /** Whether an agent has, or is about to have, what's waiting on one: false once nothing is listening. */
  listening: boolean;
  /** The agent the reviewer started to fix what they sent, if they did (#279). */
  fixer?: ReviewFixer;
  /** Whether an agent started here could fix this review's findings (#279). */
  fixable: boolean;
}): ReviewStatusLine[] {
  const { caller, decision, decidedAt, annotations, listening, fixer, fixable } = input;
  const lines: ReviewStatusLine[] = [];

  // A decision stands until the change comes back as a new round (#269).
  const decided = decision ? DECIDED[decision] : undefined;
  if (decided) return [{ tone: "decided", text: decided }];

  // Findings and questions out with the agent (#274): nothing to decide yet.
  // Everything the reviewer is waiting on the agent for: findings sent to be
  // fixed, and questions to be answered alike.
  const outstanding = annotations.filter(awaitingAgent).length;
  const fixed = annotations.filter((t) => fixedByAgent(t, decidedAt)).length;
  const soFar = fixed > 0 ? `, ${fixed} fixed so far` : "";
  const them = outstanding === 1 ? "it" : "them";
  // Only when nothing has them: an agent beside a listening one would fix them twice.
  const restart = outstanding > 0 && fixable && !listening ? ("start-fixer" as const) : undefined;
  // A failure matters while there's still something it was meant to fix.
  if (fixer?.state === "failed" && outstanding > 0) {
    lines.push({ tone: "stale", text: `${fixer.label} stopped fixing: ${fixer.error ?? "it didn't say why."}`, action: restart });
  }
  if (outstanding > 0 && fixer?.state === "running") {
    lines.push({
      tone: "waiting-on-agent",
      text: `${fixer.label} is fixing ${outstanding === 1 ? "1 finding" : `${outstanding} findings`}${soFar}. It fixes each without committing and marks it Fixed, or answers. Wait for it, then decide.`,
    });
  } else if (outstanding > 0 && !listening) {
    // Sent, with nothing to take them (#279): say what stopped, and the step
    // that gets them to an agent. A failed fixer's line already offers it.
    if (fixer?.state !== "failed") {
      const { why, ask } = NOBODY_LISTENING[caller?.kind ?? "none"];
      const waiting = `${outstanding} ${outstanding === 1 ? "is" : "are"} waiting for an agent, but ${why}.`;
      const step = fixable ? `Start an agent here to fix ${them}, or ${ask}.` : `To get ${them} answered, ${ask}.`;
      lines.push({ tone: "stale", text: `${waiting} ${step}`, action: restart });
    }
  } else if (outstanding > 0) {
    const sent = `${outstanding} ${outstanding === 1 ? "is" : "are"} with the agent`;
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
