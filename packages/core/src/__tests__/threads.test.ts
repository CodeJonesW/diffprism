import { describe, it, expect } from "vitest";
import { awaitingAgent, lastAuthor, lastMessageAt, pickedUpByAgent } from "../threads.js";
import type { Annotation } from "../types.js";

function thread(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1", sessionId: "s1", file: "a.ts", line: 1, side: "new", body: "x", type: "question",
    confidence: 1, category: "other", source: { agent: "reviewer" }, createdAt: 1, ...over,
  };
}
const reply = (author: "agent" | "reviewer") => ({ id: `r-${author}`, author, body: "r", createdAt: 2 });

describe("threads", () => {
  it("treats an annotation from before threads as an agent's", () => {
    expect(lastAuthor(thread())).toBe("agent");
    expect(awaitingAgent(thread())).toBe(false);
  });

  it("waits on an agent when the reviewer opened the thread and nobody answered", () => {
    expect(awaitingAgent(thread({ author: "reviewer" }))).toBe(true);
  });

  it("stops waiting once an agent replies", () => {
    expect(awaitingAgent(thread({ author: "reviewer", replies: [reply("agent")] }))).toBe(false);
  });

  it("waits again when the reviewer replies to an agent", () => {
    expect(awaitingAgent(thread({ author: "agent", replies: [reply("agent"), reply("reviewer")] }))).toBe(true);
  });

  it("never waits on a dismissed thread", () => {
    expect(awaitingAgent(thread({ author: "reviewer", dismissed: true }))).toBe(false);
  });

  it("dates a thread by its latest message", () => {
    expect(lastMessageAt(thread({ createdAt: 1 }))).toBe(1);
    expect(lastMessageAt(thread({ createdAt: 1, replies: [reply("agent"), { ...reply("reviewer"), createdAt: 9 }] }))).toBe(9);
  });

  it("counts a thread as picked up only by an agent read after its latest message", () => {
    const question = thread({ author: "reviewer", createdAt: 5 });
    expect(pickedUpByAgent(question, undefined)).toBe(false);
    expect(pickedUpByAgent(question, 4)).toBe(false);
    // Same millisecond: the read may have come first. The next read settles it.
    expect(pickedUpByAgent(question, 5)).toBe(false);
    expect(pickedUpByAgent(question, 6)).toBe(true);
  });
});
