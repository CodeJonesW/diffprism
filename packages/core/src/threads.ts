import type { Annotation, ThreadAuthor } from "./types.js";

/** Who wrote the latest message in a thread. */
export function lastAuthor(annotation: Annotation): ThreadAuthor {
  const replies = annotation.replies ?? [];
  return replies.length > 0 ? replies[replies.length - 1].author : (annotation.author ?? "agent");
}

/**
 * True when the reviewer spoke last and no agent has answered — what an agent
 * waiting for comments is waiting for.
 */
export function awaitingAgent(annotation: Annotation): boolean {
  return !annotation.dismissed && lastAuthor(annotation) === "reviewer";
}

/** When the latest message in a thread was written. */
export function lastMessageAt(annotation: Annotation): number {
  const replies = annotation.replies ?? [];
  return replies.length > 0 ? replies[replies.length - 1].createdAt : annotation.createdAt;
}

/**
 * True when an agent has read the session's threads since this one's latest
 * message. `agentReadAt` is SessionSummary.agentReadAt.
 */
export function pickedUpByAgent(annotation: Annotation, agentReadAt: number | undefined): boolean {
  return agentReadAt !== undefined && agentReadAt > lastMessageAt(annotation);
}
