import type { Annotation } from "../types";
import { agentPickup, awaitingAgent, lastAuthor } from "./threads";

// ─── Sending a dojo finding to the agent that made the change (#238, #256) ───
//
// A local review's agent — whatever ran `git commit`, or called open_review —
// gets a finding as a request on its thread, which the agent's next wait
// hands over. It fixes the code without committing and says so, or replies
// why not. Every finding goes this one way, so every one can be followed:
// where it stands is read off its thread, never recorded beside it.

/** What the reviewer says on a finding's thread to hand it to the agent to fix. */
export const ASK_AGENT = "Please fix this, or reply to say why it isn't a problem.";

export interface FindingSent {
  /**
   * Sent on its thread and not yet read by an agent (`pending`), read
   * (`picked_up`), sent with no agent listening (`unheard`), answered, or
   * fixed: the agent's latest reply says it fixed it (#256).
   */
  asked: ReturnType<typeof agentPickup> | "answered" | "fixed" | null;
  /** What the agent says it changed, when `asked` is `fixed`. */
  fixedNote?: string;
  /** The reviewer dismissed its thread: done with, and not sent anywhere. */
  dismissed: boolean;
}

export function findingSent(
  thread: Annotation | undefined,
  pickup: (thread: Annotation) => ReturnType<typeof agentPickup>,
): FindingSent {
  if (!thread) return { asked: null, dismissed: false };
  const dismissed = !!thread.dismissed;
  // The latest word wins: a reviewer asking again after a fix reopens it.
  const latest = thread.replies?.at(-1);
  if (latest?.author === "agent" && latest.fixed) {
    return { asked: "fixed", fixedNote: latest.body, dismissed };
  }
  const reviewerReplied = (thread.replies ?? []).some((r) => r.author === "reviewer");
  const asked = awaitingAgent(thread)
    ? pickup(thread)
    : reviewerReplied && lastAuthor(thread) === "agent"
      ? "answered"
      : null;
  return { asked, dismissed };
}
