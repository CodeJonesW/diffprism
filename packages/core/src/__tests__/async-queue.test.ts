import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../async-queue.js";

async function all<T>(queue: AsyncQueue<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of queue) out.push(item);
  return out;
}

describe("AsyncQueue", () => {
  it("keeps what was pushed before reading, and ends after it", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.end();
    expect(await all(q)).toEqual([1, 2]);
  });

  it("hands a waiting reader the next value, and ends it on end()", async () => {
    const q = new AsyncQueue<string>();
    const read = all(q);
    q.push("a");
    await Promise.resolve();
    q.push("b");
    q.end();
    expect(await read).toEqual(["a", "b"]);
  });

  it("ignores pushes after end()", async () => {
    const q = new AsyncQueue<number>();
    q.end();
    q.push(1);
    expect(await all(q)).toEqual([]);
  });
});
