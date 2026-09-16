import type { Annotation, ThreadAuthor } from "../types";

/**
 * Mirrors awaitingAgent in @diffprism/core, which the UI can't import at
 * runtime. The MCP server uses core's to decide what an agent is waiting for;
 * this only decides whether to say "waiting for the agent".
 */
export function lastAuthor(annotation: Annotation): ThreadAuthor {
  const replies = annotation.replies ?? [];
  return replies.length > 0 ? replies[replies.length - 1].author : (annotation.author ?? "agent");
}

export function awaitingAgent(annotation: Annotation): boolean {
  return !annotation.dismissed && lastAuthor(annotation) === "reviewer";
}
