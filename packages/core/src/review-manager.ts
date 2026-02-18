import type { ReviewResult, ReviewOptions } from "./types.js";

export interface ReviewSession {
  id: string;
  options: ReviewOptions;
  status: "pending" | "in_progress" | "completed";
  result?: ReviewResult;
  createdAt: number;
}

const sessions = new Map<string, ReviewSession>();

let idCounter = 0;

export function createSession(options: ReviewOptions): ReviewSession {
  const id = `review-${Date.now()}-${++idCounter}`;
  const session: ReviewSession = {
    id,
    options,
    status: "pending",
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): ReviewSession | undefined {
  return sessions.get(id);
}

export function updateSession(
  id: string,
  update: Partial<Pick<ReviewSession, "status" | "result">>,
): void {
  const session = sessions.get(id);
  if (session) {
    Object.assign(session, update);
  }
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}
