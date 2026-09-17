import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@diffprism/core", async () => {
  const actual = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
  return { isServerAlive: vi.fn(), recordError: vi.fn(), REPORT_HINT: actual.REPORT_HINT };
});

import { isServerAlive } from "@diffprism/core";
import { reply, replyCommandFor } from "../commands/reply.js";

class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${code}`);
  }
}

describe("diffprism reply (#179)", () => {
  const fetchMock = vi.fn();
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Exit(code);
    }) as never);
    vi.mocked(isServerAlive).mockResolvedValue({ httpPort: 7, wsPort: 8, pid: 1, startedAt: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function run(...args: Parameters<typeof reply>): Promise<number | undefined> {
    try {
      await reply(...args);
    } catch (e) {
      if (e instanceof Exit) return e.code;
      throw e;
    }
    return undefined;
  }

  it("posts the words as the agent's reply on that thread", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ replyId: "r1", annotation: { file: "apps/sw.ts", line: 51 } }), { status: 200 }),
    );

    expect(await run("q1", ["It", "caches", "the", "shell."], { session: "s1", agent: "claude-code" })).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:7/api/reviews/s1/annotations/q1/replies",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ author: "agent", agent: "claude-code", body: "It caches the shell." });
    expect(out.join("\n")).toContain("Replied on apps/sw.ts:51");
    // The next step, where the agent is looking: go back to waiting, not to the terminal.
    expect(out.join("\n")).toContain("Go back to waiting for the decision now");
  });

  it("fails with the server's reason when the reply is refused", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Annotation not found" }), { status: 404 }));

    expect(await run("nope", ["hi"], { session: "s1" })).toBe(1);
    expect(err.join("\n")).toContain("Annotation not found");
  });

  it("fails when no server is running", async () => {
    vi.mocked(isServerAlive).mockResolvedValue(null);

    expect(await run("q1", ["hi"], { session: "s1" })).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an empty reply", async () => {
    expect(await run("q1", ["  "], { session: "s1" })).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prints a command that parses back to the same session and thread", () => {
    expect(replyCommandFor("s1", "q1")).toBe('diffprism reply --session s1 q1 "<your answer>"');
  });
});
