import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncQueue, DojoStoppedError } from "@diffprism/core";
import type { DojoRequest, DojoRun, DojoSeat, GlobalServerInfo, ReviewAgentName } from "@diffprism/core";
import { runDojo, dojoRunner, parseFindings, parseVotes, lastJsonBlock, describeSubject, dojoInstructions } from "../commands/dojo.js";
import type { DojoDeps } from "../commands/dojo.js";
import type { AgentKind, AgentInvocation, AgentProcess } from "../commands/pr-agent.js";

const json = (value: unknown) => `Thinking about it...\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`;

const finding = (title: string, line = 3) => ({ file: "src/a.ts", line, side: "new", severity: "major", title, body: `${title}.` });

/**
 * A fake agent: `begin` names its conversation, `turn` passes the round and
 * prompt through as args, and an event `{ doing }` is it doing something.
 */
function kind(name: ReviewAgentName, label: string): AgentKind {
  return {
    name,
    label,
    command: name,
    installHint: `install ${name}`,
    begin: vi.fn(async () => ({ id: `${name}-conv`, cwd: `/agents/${name}`, resumeCommand: "" })),
    turn: vi.fn((_review, _conversation, t): AgentInvocation => ({ args: [t.first ? "review" : "vote", t.prompt] })),
    describe: (event) => (event as { doing?: string }).doing ?? null,
    toolCalls: (event) => (event as { tool?: number }).tool ?? 0,
  };
}

/** A turn that streams `events`, then ends with `output`. */
function turnOf(output: string, events: unknown[] = []): AgentProcess {
  const queue = new AsyncQueue<unknown>();
  events.forEach((e) => queue.push(e));
  queue.end();
  return { events: queue, done: Promise.resolve({ code: 0, output }), kill: () => {} };
}

/** The dojo's result, once its progress has been read to the end. */
async function finish(run: DojoRun): Promise<{ seats: DojoSeat[]; result: Awaited<DojoRun["result"]> }> {
  const seats: DojoSeat[] = [];
  for await (const seat of run.progress) seats.push(seat);
  return { seats, result: await run.result };
}

const request: DojoRequest = {
  sessionId: "s1",
  subject: { kind: "pr", url: "https://github.com/acme/widget/pull/7" },
  localRepoPath: "/checkouts/acme/widget/pr-7",
  server: { httpPort: 1, wsPort: 2, pid: 3, startedAt: 0 } as GlobalServerInfo,
  agents: [{ name: "claude" }, { name: "cursor", model: "gpt-5" }],
  skills: [],
};

/** Each agent's answers: its round-one findings, and its votes (or a raw output to fail with). */
function deps(answers: Partial<Record<ReviewAgentName, { review: unknown; vote?: unknown }>>, extra: Partial<DojoDeps> = {}): DojoDeps {
  return {
    kinds: { claude: kind("claude", "Claude Code"), cursor: kind("cursor", "Cursor") },
    installed: async () => true,
    run: vi.fn((command: string, { args }: AgentInvocation) => {
      const answer = answers[command as ReviewAgentName];
      const reply = args[0] === "review" ? answer?.review : answer?.vote;
      const doing = args[0] === "review" ? "reviewing" : "voting";
      // The same activity twice in a row is reported once.
      return turnOf(typeof reply === "string" ? reply : json(reply), [{ doing }, { doing }]);
    }),
    mcp: { command: "node", args: ["serve"] },
    folder: () => "/tmp/x",
    log: () => {},
    now: () => 100,
    quietLimitMs: 60_000,
    toolQuietLimitMs: 60_000,
    ...extra,
  };
}

describe("runDojo (#231)", () => {
  it("has each agent review, then vote on the others' findings, and combines the votes", async () => {
    const d = deps({
      claude: { review: { findings: [finding("Leaks a handle")] }, vote: { votes: [{ findingId: "cursor-1", stance: "disagree", severity: "nit", note: "handled upstream" }] } },
      cursor: { review: { findings: [finding("Unchecked input", 9)] }, vote: { votes: [{ findingId: "claude-1", stance: "agree", severity: "critical", note: "yes" }] } },
    });

    const result = (await finish(runDojo(request, d))).result;

    expect(result.agents).toEqual([
      { agent: { name: "claude" }, label: "Claude Code", stage: "done", stageStartedAt: 100, raised: 1, reviewedInMs: 0, votedInMs: 0 },
      { agent: { name: "cursor", model: "gpt-5" }, label: "Cursor", stage: "done", stageStartedAt: 100, raised: 1, reviewedInMs: 0, votedInMs: 0 },
    ]);
    expect(result.findings.map((f) => [f.id, f.consensus])).toEqual([
      ["claude-1", "agreed"],
      ["cursor-1", "disputed"],
    ]);
    // Cursor's vote is on Claude's finding only, and names who found it.
    const cursorVotePrompt = vi.mocked(d.run).mock.calls.find(([c, inv]) => c === "cursor" && inv.args[0] === "vote")![1].args[1];
    expect(cursorVotePrompt).toContain("claude-1 — from Claude Code — src/a.ts:3 [major] Leaks a handle");
    expect(cursorVotePrompt).not.toContain("cursor-1");
  });

  it("runs both rounds in one conversation per agent, with the dojo's instructions", async () => {
    const d = deps({ claude: { review: { findings: [] } }, cursor: { review: { findings: [finding("x")] }, vote: { votes: [] } } });
    (await finish(runDojo(request, d))).result;

    const claudeTurns = vi.mocked(d.kinds.claude.turn).mock.calls;
    expect(claudeTurns.map(([, conversation, t]) => [conversation.id, t.first])).toEqual([
      ["claude-conv", true],
      ["claude-conv", false],
    ]);
    expect(claudeTurns[0][2].instructions).toContain("review dojo on https://github.com/acme/widget/pull/7");
    expect(claudeTurns[0][0].model).toBeUndefined();
    expect(vi.mocked(d.kinds.cursor.turn).mock.calls[0][0].model).toBe("gpt-5");
    // Cursor had nobody else's findings to vote on.
    expect(vi.mocked(d.kinds.cursor.turn).mock.calls).toHaveLength(1);
  });

  it("reviews a commit-gate review's staged changes, in the repo they're in (#238)", async () => {
    const d = deps({ claude: { review: { findings: [] } } });
    const local: DojoRequest = {
      ...request,
      subject: { kind: "local", repoPath: "/work/app", diffRef: "staged" },
      localRepoPath: "/work/app",
      agents: [{ name: "claude" }],
    };
    (await finish(runDojo(local, d))).result;

    const [review, , turn] = vi.mocked(d.kinds.claude.turn).mock.calls[0];
    expect(review.localRepoPath).toBe("/work/app");
    expect(review.subject).toBe("the staged changes — what the next commit will contain — in /work/app");
    expect(turn.instructions).toContain("review dojo on the staged changes");
    // The files on disk aren't the commit.
    expect(turn.instructions).toContain("Judge the staged version of each file");
    expect(turn.prompt).toContain("review this change on your own");
  });

  it("names any other local diff by its ref, and doesn't warn off the working tree for it", () => {
    expect(describeSubject({ kind: "local", repoPath: "/work/app", diffRef: "working-copy" })).toBe("the uncommitted changes in /work/app");
    expect(describeSubject({ kind: "local", repoPath: "/work/app", diffRef: "main..feature" })).toBe("the diff main..feature in /work/app");
    expect(describeSubject({ kind: "pr", url: "https://github.com/acme/widget/pull/7" })).toBe("https://github.com/acme/widget/pull/7");
    const instructions = dojoInstructions({ sessionId: "s1", localRepoPath: "/work/app", skills: [], subject: { kind: "local", repoPath: "/work/app", diffRef: "working-copy" } }, "Cursor");
    expect(instructions).not.toContain("staged version");
  });

  it("gives every agent the skills the reviewer chose, in its instructions (#290)", () => {
    const instructions = dojoInstructions(
      {
        sessionId: "s1",
        localRepoPath: "/work/app",
        subject: { kind: "local", repoPath: "/work/app", diffRef: "staged" },
        skills: [{ name: "security-review", instructions: "Check every input that crosses a trust boundary." }],
      },
      "Cursor",
    );
    expect(instructions).toContain("The reviewer asked the dojo to review by these skills.");
    expect(instructions).toContain("## Skill: security-review\n\nCheck every input that crosses a trust boundary.");
    // None chosen, none mentioned.
    expect(dojoInstructions({ ...request, skills: [] }, "Cursor")).not.toContain("Skill:");
  });

  it("drops an agent that can't review, says why, and goes on without it", async () => {
    const d = deps({
      claude: { review: "I looked and it seems fine!" },
      cursor: { review: { findings: [finding("x")] } },
    });

    const result = (await finish(runDojo(request, d))).result;

    expect(result.agents[0].error).toMatch(/^couldn't review: didn't answer with a JSON block/);
    expect(result.agents[1].error).toBeUndefined();
    expect(result.findings.map((f) => [f.id, f.consensus])).toEqual([["cursor-1", "solo"]]);
  });

  it("drops an agent that isn't installed", async () => {
    const d = deps({ cursor: { review: { findings: [] } } }, { installed: async (k) => k.name === "cursor" });
    const result = (await finish(runDojo(request, d))).result;
    expect(result.agents[0].error).toBe("couldn't start: isn't installed (install claude).");
    expect(d.kinds.claude.begin).not.toHaveBeenCalled();
  });

  it("keeps an agent's findings when only its vote fails", async () => {
    const d = deps({
      claude: { review: { findings: [finding("a")] }, vote: "no json here" },
      cursor: { review: { findings: [finding("b")] }, vote: { votes: [{ findingId: "claude-1", stance: "agree", severity: "major", note: "" }] } },
    });

    const result = (await finish(runDojo(request, d))).result;

    expect(result.agents[0].error).toMatch(/^couldn't vote/);
    expect(result.findings.map((f) => [f.id, f.consensus])).toEqual([
      ["claude-1", "agreed"],
      ["cursor-1", "partial"],
    ]);
  });

  it("reports every step of each agent as it happens", async () => {
    const d = deps({
      claude: { review: { findings: [finding("a")] }, vote: { votes: [] } },
      cursor: { review: { findings: [finding("b"), finding("c")] }, vote: { votes: [] } },
    });

    const { seats } = await finish(runDojo(request, d));

    const claude = seats.filter((s) => s.agent.name === "claude").map((s) => [s.stage, s.activity, s.raised]);
    expect(claude).toEqual([
      ["starting", undefined, undefined],
      ["reviewing", undefined, undefined],
      ["reviewing", "reviewing", undefined],
      // Its review is in; it waits for the others' before it can vote (#251).
      ["waiting", undefined, 1],
      ["voting", undefined, 1],
      ["voting", "voting", 1],
      ["done", undefined, 1],
    ]);
    expect(seats.filter((s) => s.agent.name === "cursor").at(-1)).toMatchObject({ stage: "done", raised: 2 });
  });

  it("times each agent on its own, so a fast one's time isn't the slow one's (#272)", async () => {
    // Claude answers at once; Cursor finishes each turn 5s later on the clock.
    let clock = 0;
    const slowFor = (command: string, output: string): AgentProcess => ({
      events: (async function* () {})(),
      done:
        command === "cursor"
          ? new Promise((resolve) =>
              setTimeout(() => {
                clock += 5000;
                resolve({ code: 0, output });
              }, 5),
            )
          : Promise.resolve({ code: 0, output }),
      kill: () => {},
    });
    const d = deps(
      {},
      {
        now: () => clock,
        run: vi.fn((command: string, { args }: AgentInvocation) =>
          slowFor(command, json(args[0] === "review" ? { findings: [finding(`${command} found`)] } : { votes: [] })),
        ),
      },
    );

    const { agents } = (await finish(runDojo(request, d))).result;

    expect(agents.map((a) => [a.label, a.reviewedInMs, a.votedInMs])).toEqual([
      ["Claude Code", 0, 0],
      ["Cursor", 5000, 5000],
    ]);
  });

  it("reports an agent dropping out, with why", async () => {
    const d = deps({ cursor: { review: { findings: [] } } }, { installed: async (k) => k.name === "cursor" });
    const { seats } = await finish(runDojo(request, d));
    expect(seats.filter((s) => s.agent.name === "claude").map((s) => s.stage)).toEqual(["starting", "dropped"]);
  });

  describe("stopping (#252)", () => {
    /** A turn that runs until it's killed, then ends as a killed process does. */
    function endless(): AgentProcess {
      const queue = new AsyncQueue<unknown>();
      let end = (_run: { code: number; output: string }) => {};
      const done = new Promise<{ code: number; output: string }>((resolve) => (end = resolve));
      return {
        events: queue,
        done,
        kill: vi.fn(() => {
          queue.end();
          end({ code: 143, output: "" });
        }),
      };
    }

    it("stops every agent still working, and says why", async () => {
      const turns: AgentProcess[] = [];
      const d = deps({}, { run: vi.fn(() => turns[turns.push(endless()) - 1]) });
      const run = runDojo(request, d);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(turns).toHaveLength(2);

      run.stop("Stopped by the reviewer.");

      await expect(run.result).rejects.toThrow(DojoStoppedError);
      await expect(run.result).rejects.toThrow("Stopped by the reviewer.");
      for (const turn of turns) expect(turn.kill).toHaveBeenCalled();
    });

    it("doesn't start voting once stopped", async () => {
      const d = deps({
        claude: { review: { findings: [finding("a")] }, vote: { votes: [] } },
        cursor: { review: { findings: [finding("b")] }, vote: { votes: [] } },
      });
      const run = runDojo(request, d);
      run.stop("The review was decided.");
      await expect(run.result).rejects.toThrow("The review was decided.");
      expect(vi.mocked(d.run).mock.calls.filter(([, inv]) => inv.args[0] === "vote")).toEqual([]);
    });

    it("gives a tool call under way longer before counting it as silence", async () => {
      // A tool call starts, runs longer than the quiet limit, then returns.
      const slowTool = (output: string): AgentProcess => {
        const queue = new AsyncQueue<unknown>();
        queue.push({ tool: 1 });
        const done = new Promise<{ code: number; output: string }>((resolve) =>
          setTimeout(() => {
            queue.push({ tool: -1 });
            queue.end();
            resolve({ code: 0, output });
          }, 120),
        );
        return { events: queue, done, kill: vi.fn() };
      };
      const d = deps(
        {},
        {
          quietLimitMs: 30,
          toolQuietLimitMs: 1000,
          run: vi.fn((_command: string, { args }: AgentInvocation) =>
            slowTool(json(args[0] === "review" ? { findings: [finding("slow but fine")] } : { votes: [] })),
          ),
        },
      );

      const result = await runDojo(request, d).result;

      expect(result.agents.map((a) => a.stage)).toEqual(["done", "done"]);
    });

    it("drops an agent that goes quiet too long, and the rest carry on", async () => {
      const quiet = endless();
      const d = deps(
        { cursor: { review: { findings: [finding("b")] } } },
        {
          quietLimitMs: 30,
          run: vi.fn((command: string, { args }: AgentInvocation) =>
            command === "claude" ? quiet : turnOf(json(args[0] === "review" ? { findings: [finding("b")] } : { votes: [] })),
          ),
        },
      );

      const result = await runDojo(request, d).result;

      expect(quiet.kill).toHaveBeenCalled();
      expect(result.agents[0]).toMatchObject({ stage: "dropped", error: "couldn't review: went quiet: nothing for 0s, so it was stopped." });
      expect(result.findings.map((f) => [f.id, f.consensus])).toEqual([["cursor-1", "solo"]]);
    });
  });

  it("fails when no agent could review at all", async () => {
    const d = deps({}, { installed: async () => false });
    await expect(runDojo(request, d).result).rejects.toThrow(/No agent could review\. Claude Code couldn't start: isn't installed/);
  });
});

describe("reading an agent's answer", () => {
  it("takes the last json block", () => {
    expect(lastJsonBlock('```json\n{"a":1}\n```\nthen\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("accepts bare JSON", () => {
    expect(lastJsonBlock('  {"findings": []} ')).toEqual({ findings: [] });
  });

  it("refuses a finding without a real severity or line", () => {
    expect(() => parseFindings(json({ findings: [{ ...finding("x"), severity: "huge" }] }))).toThrow(/severity "huge"/);
    expect(() => parseFindings(json({ findings: [{ ...finding("x"), line: 0 }] }))).toThrow(/no line number/);
  });

  it("reads a removed line's side, and defaults to the new file", () => {
    const [removed, added] = parseFindings(json({ findings: [{ ...finding("x"), side: "old" }, { ...finding("y"), side: undefined }] }));
    expect([removed.side, added.side]).toEqual(["old", "new"]);
  });

  it("refuses a vote with no stance", () => {
    expect(() => parseVotes(json({ votes: [{ findingId: "claude-1", severity: "minor" }] }))).toThrow(/stance "undefined"/);
  });
});

describe("dojoRunner", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "dojo-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("offers the installed agents, with the model each would use", async () => {
    fs.mkdirSync(path.join(home, ".diffprism"));
    fs.writeFileSync(path.join(home, ".diffprism", "config.json"), JSON.stringify({ agent: { models: { cursor: "gpt-5" } } }));
    const runner = dojoRunner({
      kinds: { claude: kind("claude", "Claude Code"), cursor: kind("cursor", "Cursor") },
      installed: async (k) => k.name === "cursor",
    });

    expect(await runner.available()).toEqual([{ name: "cursor", label: "Cursor", model: "gpt-5" }]);
  });
});
