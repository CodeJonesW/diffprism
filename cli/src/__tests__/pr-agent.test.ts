import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Annotation, GlobalServerInfo, ReviewResult } from "@diffprism/core";

vi.mock("@diffprism/core", async () => {
  const actual = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
  return { ...actual, waitForDecision: vi.fn() };
});

import { waitForDecision, ReviewerAskedError, ReviewTimeoutError } from "@diffprism/core";
import {
  CLAUDE,
  CURSOR,
  agentPrompt,
  listenWithAgent,
  AgentStalledError,
  AGENT_ALLOWED_TOOLS,
  AGENT_DISALLOWED_TOOLS,
  prAgentStarter,
} from "../commands/pr-agent.js";
import type {
  AgentConversation,
  AgentKind,
  AgentReview,
  AgentRunner,
  ListenOptions,
  ListenOutcome,
} from "../commands/pr-agent.js";

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

function review(overrides: Partial<AgentReview> = {}): AgentReview {
  return {
    reviewSessionId: "session-1",
    prUrl: "acme/widget#7",
    localRepoPath: "/clones/widget",
    mcp,
    folder: () => "/tmp/diffprism-agent/session-1",
    ...overrides,
  };
}

const conversation: AgentConversation = { id: "conv-7", cwd: "/clones/widget", resumeCommand: "resume conv-7" };

function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe("Claude Code", () => {
  const args = (first: boolean, r = review()) => CLAUDE.turn(r, conversation, { first, prompt: "the threads" }).args;

  it("starts the conversation on the first turn and resumes it after", () => {
    expect(argAfter(args(true), "--session-id")).toBe("conv-7");
    expect(args(true)).not.toContain("--resume");
    expect(argAfter(args(false), "--resume")).toBe("conv-7");
    expect(args(false)).not.toContain("--session-id");
  });

  it("sends the threads on stdin", () => {
    expect(CLAUDE.turn(review(), conversation, { first: true, prompt: "the threads" }).stdin).toBe("the threads");
  });

  it("can read and reply, and cannot change anything", () => {
    const allowed = argAfter(args(true), "--allowedTools")!.split(",");
    const denied = argAfter(args(true), "--disallowedTools")!.split(",");

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
    expect(argAfter(args(true), "--permission-mode")).toBe("default");
  });

  it("uses only this build's DiffPrism MCP server", () => {
    expect(JSON.parse(argAfter(args(true), "--mcp-config")!)).toEqual({ mcpServers: { diffprism: mcp } });
    expect(args(true)).toContain("--strict-mcp-config");
  });

  it("tells the agent which review to reply on, and to sign as Claude Code", () => {
    const system = argAfter(args(true), "--append-system-prompt")!;
    expect(system).toContain('session_id "session-1"');
    expect(system).toContain('source_agent "Claude Code"');
  });

  it("uses the model chosen, and otherwise leaves it to Claude Code (#226)", () => {
    expect(argAfter(args(true, review({ model: "opus" })), "--model")).toBe("opus");
    expect(args(true)).not.toContain("--model");
  });

  it("runs in the clone, and names how to resume it from anywhere", async () => {
    const started = await CLAUDE.begin(review({ localRepoPath: "/clones/my widget" }));
    expect(started.cwd).toBe("/clones/my widget");
    expect(started.resumeCommand).toBe(`cd '/clones/my widget' && claude --resume ${started.id}`);
  });

  it("runs in its own folder when there's no clone", async () => {
    expect((await CLAUDE.begin(review({ localRepoPath: null }))).cwd).toBe("/tmp/diffprism-agent/session-1");
  });
});

describe("Cursor (#226)", () => {
  const cursorConversation = { ...conversation, cwd: "/tmp/diffprism-agent/session-1" };
  const args = (first: boolean, r = review()) => CURSOR.turn(r, cursorConversation, { first, prompt: "the threads" }).args;

  it("resumes the chat it started, every turn", () => {
    expect(argAfter(args(true), "--resume")).toBe("conv-7");
    expect(argAfter(args(false), "--resume")).toBe("conv-7");
  });

  // Ask mode refuses the reply tool as a write; read-only comes from the
  // permissions file instead, and nothing may override it.
  it("doesn't use ask mode, and never forces commands through", () => {
    expect(args(true)).not.toContain("--mode");
    expect(args(true)).not.toContain("--force");
    expect(args(true)).not.toContain("--yolo");
  });

  it("works in its own folder and reads the clone from there", () => {
    expect(argAfter(args(true), "--workspace")).toBe("/tmp/diffprism-agent/session-1");
    expect(argAfter(args(true), "--add-dir")).toBe("/clones/widget");
    expect(args(true, review({ localRepoPath: null }))).not.toContain("--add-dir");
  });

  it("uses the model chosen, and otherwise leaves it to Cursor", () => {
    expect(argAfter(args(true, review({ model: "gpt-5" })), "--model")).toBe("gpt-5");
    expect(args(true)).not.toContain("--model");
  });

  // Cursor has no separate system prompt.
  it("leads the first turn with the instructions, and later turns with just the threads", () => {
    const first = args(true).at(-1)!;
    expect(first).toContain('source_agent "Cursor"');
    expect(first).toMatch(/the threads$/);
    expect(args(false).at(-1)).toBe("the threads");
  });

  describe("starting a chat", () => {
    let dir: string;
    let originalPath: string | undefined;

    /**
     * A stand-in cursor-agent that behaves like the real one: `status` reports
     * the login, and `create-chat` prints an id and then doesn't exit.
     */
    function fakeCursor(loggedIn: boolean) {
      const bin = path.join(dir, "bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(
        path.join(bin, "cursor-agent"),
        [
          "#!/bin/sh",
          `[ "$1" = status ] && echo '{"isAuthenticated": ${loggedIn}}' && exit 0`,
          '[ "$1" = create-chat ] && echo chat-123 && sleep 30',
          "",
        ].join("\n"),
      );
      fs.chmodSync(path.join(bin, "cursor-agent"), 0o755);
      process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
    }

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cursor-"));
      originalPath = process.env.PATH;
    });

    afterEach(() => {
      process.env.PATH = originalPath;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("says to log in when Cursor isn't, rather than waiting on a chat", async () => {
      fakeCursor(false);
      await expect(CURSOR.begin(review({ folder: () => dir }))).rejects.toThrow(/Cursor isn't logged in\. Run `cursor-agent login`/);
    });

    // Cursor reads MCP servers only from .cursor/mcp.json in its workspace.
    it("gives its own folder the DiffPrism tools and read-only permissions, and leaves the clone alone", async () => {
      fakeCursor(true);
      const clone = path.join(dir, "clone");
      const folder = path.join(dir, "agent");
      fs.mkdirSync(clone);
      fs.mkdirSync(folder);

      // The fake never exits after printing its id: this only finishes because
      // the id is read as soon as it's printed.
      const started = await CURSOR.begin(review({ localRepoPath: clone, folder: () => folder }));

      expect(started.id).toBe("chat-123");
      expect(started.cwd).toBe(folder);
      expect(JSON.parse(fs.readFileSync(path.join(folder, ".cursor", "mcp.json"), "utf-8"))).toEqual({
        mcpServers: { diffprism: mcp },
      });
      expect(JSON.parse(fs.readFileSync(path.join(folder, ".cursor", "cli.json"), "utf-8"))).toEqual({
        permissions: { allow: ["Read(**)", "Mcp(diffprism:*)"], deny: ["Shell(*)", "Write(**)"] },
      });
      expect(fs.existsSync(path.join(clone, ".cursor"))).toBe(false);
      expect(started.resumeCommand).toBe(`cd ${folder} && cursor-agent --resume chat-123`);
    });
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

describe("listenWithAgent", () => {
  beforeEach(() => {
    mockWait.mockReset();
  });

  type Call = { command: string; args: string[]; stdin?: string; cwd: string };

  /** A runner that answers every turn successfully and records what it was given. */
  function recordingRunner(): { run: AgentRunner; calls: Call[] } {
    const calls: Call[] = [];
    const run: AgentRunner = async (command, { args, stdin }, cwd) => {
      calls.push({ command, args, stdin, cwd });
      return { code: 0, output: "done" };
    };
    return { run, calls };
  }

  const listen = (run: AgentRunner, kind: AgentKind = CLAUDE) =>
    listenWithAgent({ serverInfo, kind, review: review(), conversation, run });

  it("returns the decision without running the agent when nobody asks anything", async () => {
    mockWait.mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    expect(await listen(run)).toEqual({ result: approved, turns: 0 });
    expect(calls).toHaveLength(0);
  });

  it("runs the agent's command in its folder for the threads the reviewer is waiting on", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    expect((await listen(run)).turns).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("claude");
    expect(calls[0].cwd).toBe("/clones/widget");
    expect(calls[0].stdin).toContain("Thread t1");
  });

  it("runs Cursor the same way", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    await listen(run, CURSOR);
    expect(calls[0].command).toBe("cursor-agent");
    expect(calls[0].args.at(-1)).toContain("Thread t1");
  });

  it("keeps one conversation across every batch of questions", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t2", { createdAt: 2000 })]))
      .mockResolvedValueOnce(approved);
    const { run, calls } = recordingRunner();

    await listen(run);

    expect(calls).toHaveLength(2);
    expect(argAfter(calls[0].args, "--session-id")).toBe("conv-7");
    expect(argAfter(calls[1].args, "--resume")).toBe("conv-7");
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

  // Handing the agent the same unanswered threads again would loop forever,
  // spending a turn every two seconds.
  it("stops, loudly, when the agent finishes without replying", async () => {
    mockWait
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]))
      .mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]));
    const { run, calls } = recordingRunner();

    await expect(listen(run, CURSOR)).rejects.toThrow(new AgentStalledError("Cursor", [thread("t1")], "done"));
    expect(calls).toHaveLength(1);
  });

  it("stops with the agent's output when it fails", async () => {
    mockWait.mockRejectedValueOnce(new ReviewerAskedError("session-1", [thread("t1")]));
    const run: AgentRunner = async () => ({ code: 1, output: "Not logged in · Please run /login" });

    await expect(listen(run)).rejects.toThrow(/Claude Code exited with status 1:\nNot logged in/);
  });
});

// #224: the server starts one of these for every PR review; #226: the agent chosen for it.
describe("prAgentStarter", () => {
  const request = {
    sessionId: "session-1",
    prUrl: "https://github.com/acme/widget/pull/7",
    localRepoPath: "/clones/widget",
    server: serverInfo,
    agent: { name: "claude" as const, model: "opus" },
  };

  /** A kind of agent that starts without running anything. */
  function fakeKind(name: "claude" | "cursor", begin?: AgentKind["begin"]): AgentKind {
    return {
      name,
      label: name === "claude" ? "Claude Code" : "Cursor",
      command: name,
      installHint: "install it",
      begin: begin ?? (async (r) => ({ id: `${name}-conv`, cwd: r.localRepoPath ?? r.folder(), resumeCommand: `resume ${name}` })),
      turn: () => ({ args: [] }),
    };
  }

  function starter(
    listen: (o: ListenOptions) => Promise<ListenOutcome>,
    { installed = true, kinds = { claude: fakeKind("claude"), cursor: fakeKind("cursor") } } = {},
  ) {
    const lines: string[] = [];
    const start = prAgentStarter({
      kinds,
      installed: async () => installed,
      listen,
      mcp,
      folder: (id) => `/tmp/diffprism-agent/${id}`,
      log: (line) => lines.push(line),
    });
    return { start, lines };
  }

  it("starts nothing when the agent isn't installed, and says how to install it", async () => {
    const listen = vi.fn();
    const { start, lines } = starter(listen, { installed: false });

    await expect(start(request)).rejects.toThrow("Claude Code isn't installed (install it).");
    expect(listen).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Claude Code isn't installed (install it)");
  });

  it("starts the agent chosen, with its model, and reports how to resume it", async () => {
    const listen = vi.fn(async () => ({ result: approved, turns: 1 }));
    const { start } = starter(listen);

    const handle = (await start({ ...request, agent: { name: "cursor", model: "gpt-5" } }))!;
    await handle.done;

    expect(handle).toMatchObject({
      agent: { name: "cursor", model: "gpt-5" },
      label: "Cursor",
      conversationId: "cursor-conv",
      resumeCommand: "resume cursor",
    });
    expect(listen).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: expect.objectContaining({ name: "cursor" }),
        review: expect.objectContaining({ reviewSessionId: "session-1", model: "gpt-5", localRepoPath: "/clones/widget" }),
      }),
    );
  });

  it("gives the agent a folder of its own for the review", async () => {
    const listen = vi.fn(async () => ({ result: approved, turns: 0 }));
    const { start } = starter(listen);

    expect((await start({ ...request, localRepoPath: null }))!.cwd).toBe("/tmp/diffprism-agent/session-1");
  });

  // Cursor has to be logged in to start a chat.
  it("starts nothing, and says why, when the agent can't start a conversation", async () => {
    const listen = vi.fn();
    const kinds = {
      claude: fakeKind("claude"),
      cursor: fakeKind("cursor", async () => {
        throw new Error("Not logged in");
      }),
    };
    const { start, lines } = starter(listen, { kinds });

    await expect(start({ ...request, agent: { name: "cursor" } })).rejects.toThrow("Cursor couldn't start: Not logged in");
    expect(listen).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Cursor couldn't start — Not logged in");
  });

  // The server only learns that the agent stopped; a failure goes to the log.
  it("settles, and logs why, when the agent fails", async () => {
    const listen = vi.fn(async () => {
      throw new Error("Claude Code exited with status 1:\nNot logged in");
    });
    const { start, lines } = starter(listen);

    await expect((await start(request))!.done).resolves.toBeUndefined();
    expect(lines.join("\n")).toContain("agent stopped — Claude Code exited with status 1");
  });
});
