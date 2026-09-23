import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Annotation, GlobalServerInfo, ReviewResult } from "@diffprism/core";

vi.mock("@diffprism/core", async () => {
  const actual = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
  return { ...actual, waitForDecision: vi.fn() };
});

import { waitForDecision, ReviewerAskedError, ReviewTimeoutError } from "@diffprism/core";
import {
  claudeArgs,
  agentPrompt,
  listenWithClaude,
  AgentStalledError,
  AGENT_ALLOWED_TOOLS,
  AGENT_DISALLOWED_TOOLS,
} from "../commands/pr-agent.js";
import type { AgentTurn, ClaudeRunner } from "../commands/pr-agent.js";

const mockWait = vi.mocked(waitForDecision);

const serverInfo = { httpPort: 24680, wsPort: 24681, pid: 1, startedAt: 0 } as GlobalServerInfo;
const mcp = { command: "/usr/bin/node", args: ["/cli/bin.js", "serve"] };
const approved: ReviewResult = { decision: "approved", comments: [] };

function thread(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    sessionId: "session-1",
    file: "src/cache.ts",
    line: 42,
    side: "new",
    body: "Why is this cached?",
    type: "question",
    confidence: 1,
    category: "other",
    source: { agent: "reviewer", tool: "dashboard" },
    createdAt: 1000,
    author: "reviewer",
    replies: [],
    ...overrides,
  } as Annotation;
}

function turn(first: boolean): AgentTurn {
  return { reviewSessionId: "session-1", prUrl: "acme/widget#7", conversationId: "conv-1", first, mcp };
}

/** A runner that answers every turn successfully and records what it was given. */
function recordingRunner(): { run: ClaudeRunner; calls: Array<{ args: string[]; prompt: string; cwd: string }> } {
  const calls: Array<{ args: string[]; prompt: string; cwd: string }> = [];
  const run: ClaudeRunner = async (args, prompt, cwd) => {
    calls.push({ args, prompt, cwd });
    return { code: 0, output: "done" };
  };
  return { run, calls };
}

function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const listen = (run: ClaudeRunner) =>
  listenWithClaude({ serverInfo, reviewSessionId: "session-1", prUrl: "acme/widget#7", cwd: "/clones/widget", mcp, run });

describe("claudeArgs", () => {
  it("starts the conversation on the first turn and resumes it after", () => {
    expect(argAfter(claudeArgs(turn(true)), "--session-id")).toBe("conv-1");
    expect(claudeArgs(turn(true))).not.toContain("--resume");
    expect(argAfter(claudeArgs(turn(false)), "--resume")).toBe("conv-1");
    expect(claudeArgs(turn(false))).not.toContain("--session-id");
  });

  it("can read and reply, and cannot change anything", () => {
    const args = claudeArgs(turn(true));
    const allowed = argAfter(args, "--allowedTools")!.split(",");
    const denied = argAfter(args, "--disallowedTools")!.split(",");

    expect(allowed).toEqual(AGENT_ALLOWED_TOOLS);
    expect(allowed).toContain("mcp__diffprism__reply");
    for (const tool of ["Edit", "Write", "NotebookEdit", "Bash"]) {
      expect(allowed).not.toContain(tool);
      expect(denied).toContain(tool);
    }
    expect(denied).toEqual(AGENT_DISALLOWED_TOOLS);
  });

  // A permissive default mode in the user's own settings would otherwise let
  // unlisted tools through.
  it("sets the permission mode rather than inheriting the user's", () => {
    expect(argAfter(claudeArgs(turn(true)), "--permission-mode")).toBe("default");
  });

  it("uses only this build's DiffPrism MCP server", () => {
    const args = claudeArgs(turn(true));
    expect(JSON.parse(argAfter(args, "--mcp-config")!)).toEqual({ mcpServers: { diffprism: mcp } });
    expect(args).toContain("--strict-mcp-config");
  });

  it("tells the agent which review to reply on", () => {
    expect(argAfter(claudeArgs(turn(true)), "--append-system-prompt")).toContain('session_id "session-1"');
  });
});

describe("agentPrompt", () => {
  it("names each thread's id and place, and everything said in it", () => {
    const prompt = agentPrompt([
      thread("t1", {
        replies: [
          { id: "r1", author: "agent", body: "It's read on every request.", createdAt: 1100 },
          { id: "r2", author: "reviewer", body: "How often does it change?", createdAt: 1200 },
        ],
      } as Partial<Annotation>),
      thread("t2", { file: "src/old.ts", line: 3, side: "old", body: "Was this used?" }),
    ]);

    expect(prompt).toContain("waiting on 2 threads");
    expect(prompt).toContain("Thread t1 — src/cache.ts, line 42:");
    expect(prompt).toContain("Reviewer: Why is this cached?");
    expect(prompt).toContain("You: It's read on every request.");
    expect(prompt).toContain("Reviewer: How often does it change?");
    expect(prompt).toContain("Thread t2 — src/old.ts, line 3 (a removed line):");
  });
});

describe("listenWithClaude", () => {
  beforeEach(() => {
    mockWait.mockReset();
  });

  it("returns the decision without running Claude when nobody asks anything", async () => {
    mockWait.mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    expect((await listen(run)).result).toEqual(approved);
    expect(calls).toHaveLength(0);
  });

  it("runs Claude in the clone for the threads the reviewer is waiting on", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    expect((await listen(run)).result).toEqual(approved);
    expect(calls).toHaveLength(1);
    expect(calls[0].cwd).toBe("/clones/widget");
    expect(calls[0].prompt).toContain("Thread t1");
  });

  it("keeps one conversation across every batch of questions", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t2", { createdAt: 2000 })]))
      .mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    await listen(run);

    expect(calls).toHaveLength(2);
    const started = argAfter(calls[0].args, "--session-id");
    expect(started).toBeDefined();
    expect(argAfter(calls[1].args, "--resume")).toBe(started);
  });

  it("has no conversation to resume when nobody asked anything", async () => {
    mockWait.mockResolvedValueOnce(approved);
    const { run } = recordingRunner();

    expect((await listen(run)).conversationId).toBeNull();
  });

  it("names the conversation the answers were given in", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    const { conversationId } = await listen(run);
    expect(conversationId).toBe(argAfter(calls[0].args, "--session-id"));
  });

  it("keeps waiting through a timeout", async () => {
    mockWait.mockRejectedValueOnce(new ReviewTimeoutError("session-1", 600_000)).mockResolvedValueOnce(approved);
    const { run } = recordingRunner();

    expect((await listen(run)).result).toEqual(approved);
  });

  it("answers a thread again when the reviewer writes more in it", async () => {
    const followUp = thread("t1", {
      replies: [
        { id: "r1", author: "agent", body: "Yes.", createdAt: 1100 },
        { id: "r2", author: "reviewer", body: "Why?", createdAt: 1200 },
      ],
    } as Partial<Annotation>);
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [followUp]))
      .mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    await listen(run);
    expect(calls).toHaveLength(2);
  });

  // Handing Claude the same unanswered threads again would loop forever,
  // spending a turn every two seconds.
  it("stops, loudly, when Claude finishes without replying", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]));
    const { run, calls } = recordingRunner();

    await expect(listen(run)).rejects.toThrow(AgentStalledError);
    expect(calls).toHaveLength(1);
  });

  it("stops with Claude's output when it fails", async () => {
    mockWait.mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]));
    const run: ClaudeRunner = async () => ({ code: 1, output: "Not logged in · Please run /login" });

    await expect(listen(run)).rejects.toThrow(/exited with status 1:\nNot logged in/);
  });
});
