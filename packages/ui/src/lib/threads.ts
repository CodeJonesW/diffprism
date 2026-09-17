import type { Annotation, ThreadAuthor } from "../types";

/**
 * Mirrors the thread helpers in @diffprism/core, which the UI can't import at
 * runtime. The MCP server uses core's to decide what an agent is waiting for;
 * these only decide what the dashboard says about it.
 */
export function lastAuthor(annotation: Annotation): ThreadAuthor {
  const replies = annotation.replies ?? [];
  return replies.length > 0 ? replies[replies.length - 1].author : (annotation.author ?? "agent");
}

export function awaitingAgent(annotation: Annotation): boolean {
  return !annotation.dismissed && lastAuthor(annotation) === "reviewer";
}

export function lastMessageAt(annotation: Annotation): number {
  const replies = annotation.replies ?? [];
  return replies.length > 0 ? replies[replies.length - 1].createdAt : annotation.createdAt;
}

export function pickedUpByAgent(annotation: Annotation, agentReadAt: number | undefined): boolean {
  return agentReadAt !== undefined && agentReadAt > lastMessageAt(annotation);
}

/**
 * How long the reviewer's latest message may sit unread before the dashboard
 * says no agent is listening. Waiting agents read threads every 2s, so one
 * that is listening picks a message up well inside this.
 */
export const AGENT_PICKUP_GRACE_MS = 5000;

/**
 * What to tell the reviewer about a thread waiting on an agent: an agent has
 * it or is about to, or nothing is listening and nothing will answer.
 */
export function agentPickup(
  annotation: Annotation,
  agentReadAt: number | undefined,
  now: number,
): "picked_up" | "pending" | "unheard" {
  if (pickedUpByAgent(annotation, agentReadAt)) return "picked_up";
  return now - lastMessageAt(annotation) < AGENT_PICKUP_GRACE_MS ? "pending" : "unheard";
}
