import { useEffect, useState } from "react";
import type { Annotation } from "../types";
import { AGENT_PICKUP_GRACE_MS, agentPickup, awaitingAgent, lastMessageAt, pickedUpByAgent } from "../lib/threads";

/**
 * Whether each thread waiting on an agent has reached one. A thread's grace
 * period ends without any server message, so this re-renders when the next
 * one runs out — that is what turns "waiting" into "nothing is listening".
 */
export function useAgentPickup(
  annotations: Annotation[],
  agentReadAt: number | undefined,
): (annotation: Annotation) => ReturnType<typeof agentPickup> {
  const [now, setNow] = useState(() => Date.now());

  let nextDeadline: number | undefined;
  for (const annotation of annotations) {
    if (!awaitingAgent(annotation) || pickedUpByAgent(annotation, agentReadAt)) continue;
    const deadline = lastMessageAt(annotation) + AGENT_PICKUP_GRACE_MS;
    if (deadline > now && (nextDeadline === undefined || deadline < nextDeadline)) {
      nextDeadline = deadline;
    }
  }

  useEffect(() => {
    if (nextDeadline === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextDeadline - Date.now()));
    return () => clearTimeout(timer);
  }, [nextDeadline]);

  return (annotation) => agentPickup(annotation, agentReadAt, now);
}
