import type { Annotation, DojoCombinedFinding, DojoSeverity, ReviewComment } from "../types";
import { agentPickup, awaitingAgent, lastAuthor } from "./threads";

// ─── Sending a dojo finding to the agent that made the change (#238) ───
//
// A local review's agent — whatever ran `git commit`, or called open_review —
// hears from the reviewer two ways, and a finding can go either: as a question
// on its thread, which the agent's next wait returns, or as an inline comment
// in a request for changes. Where each finding stands is read off those two,
// never recorded beside them.

/** What the reviewer says on a finding's thread to hand it to the agent. */
export const ASK_AGENT = "Please fix this, or reply to say why it isn't a problem.";

const COMMENT_TYPE: Record<DojoSeverity, ReviewComment["type"]> = {
  critical: "must_fix",
  major: "must_fix",
  minor: "suggestion",
  nit: "nitpick",
};

/**
 * A finding as an inline comment in a request for changes. Its body is the
 * finding's thread's opening message: the finding, who raised it, and where
 * each other agent stands.
 */
export function findingComment(finding: DojoCombinedFinding, thread: Annotation): ReviewComment {
  return { file: finding.file, line: finding.line, side: finding.side, type: COMMENT_TYPE[finding.severity], body: thread.body };
}

export interface FindingSent {
  /**
   * Asked about on its thread: sent and not yet read by an agent (`pending`),
   * read (`picked_up`), sent with no agent listening (`unheard`), or answered.
   */
  asked: ReturnType<typeof agentPickup> | "answered" | null;
  /** One of the inline comments the reviewer's verdict will carry. */
  inVerdict: boolean;
}

export function findingSent(
  finding: DojoCombinedFinding,
  thread: Annotation | undefined,
  comments: ReviewComment[],
  pickup: (thread: Annotation) => ReturnType<typeof agentPickup>,
): FindingSent {
  if (!thread) return { asked: null, inVerdict: false };
  const comment = findingComment(finding, thread);
  const inVerdict = comments.some(
    (c) => c.file === comment.file && c.line === comment.line && c.side === comment.side && c.body === comment.body,
  );
  const reviewerReplied = (thread.replies ?? []).some((r) => r.author === "reviewer");
  const asked = awaitingAgent(thread)
    ? pickup(thread)
    : reviewerReplied && lastAuthor(thread) === "agent"
      ? "answered"
      : null;
  return { asked, inVerdict };
}
