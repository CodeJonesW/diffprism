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
