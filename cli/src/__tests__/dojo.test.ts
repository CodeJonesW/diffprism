import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DojoRequest, GlobalServerInfo, ReviewAgentName } from "@diffprism/core";
import { runDojo, dojoRunner, parseFindings, parseVotes, lastJsonBlock } from "../commands/dojo.js";
import type { DojoDeps } from "../commands/dojo.js";
import type { AgentKind, AgentInvocation } from "../commands/pr-agent.js";

const json = (value: unknown) => `Thinking about it...\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`;

const finding = (title: string, line = 3) => ({ file: "src/a.ts", line, side: "new", severity: "major", title, body: `${title}.` });

/** A fake agent: `begin` names its conversation, `turn` passes the prompt through as the only arg. */
function kind(name: ReviewAgentName, label: string): AgentKind {
  return {
    name,
    label,
    command: name,
    installHint: `install ${name}`,
    begin: vi.fn(async () => ({ id: `${name}-conv`, cwd: `/agents/${name}`, resumeCommand: "" })),
    turn: vi.fn((_review, _conversation, t): AgentInvocation => ({ args: [t.first ? "review" : "vote", t.prompt] })),
  };
}

const request: DojoRequest = {
  sessionId: "s1",
  prUrl: "https://github.com/acme/widget/pull/7",
  localRepoPath: null,
  server: { httpPort: 1, wsPort: 2, pid: 3, startedAt: 0 } as GlobalServerInfo,
  agents: [{ name: "claude" }, { name: "cursor", model: "gpt-5" }],
};

/** Each agent's answers: its round-one findings, and its votes (or a raw output to fail with). */
function deps(answers: Partial<Record<ReviewAgentName, { review: unknown; vote?: unknown }>>, extra: Partial<DojoDeps> = {}): DojoDeps {
  return {
    kinds: { claude: kind("claude", "Claude Code"), cursor: kind("cursor", "Cursor") },
    installed: async () => true,
    run: vi.fn(async (command: string, { args }: AgentInvocation) => {
      const answer = answers[command as ReviewAgentName];
      const reply = args[0] === "review" ? answer?.review : answer?.vote;
      return typeof reply === "string" ? { code: 0, output: reply } : { code: 0, output: json(reply) };
    }),
    mcp: { command: "node", args: ["serve"] },
    folder: () => "/tmp/x",
    log: () => {},
    ...extra,
  };
}

describe("runDojo (#231)", () => {
  it("has each agent review, then vote on the others' findings, and combines the votes", async () => {
    const d = deps({
      claude: { review: { findings: [finding("Leaks a handle")] }, vote: { votes: [{ findingId: "cursor-1", stance: "disagree", severity: "nit", note: "handled upstream" }] } },
      cursor: { review: { findings: [finding("Unchecked input", 9)] }, vote: { votes: [{ findingId: "claude-1", stance: "agree", severity: "critical", note: "yes" }] } },
    });

    const result = await runDojo(request, d);

    expect(result.agents).toEqual([
      { agent: { name: "claude" }, label: "Claude Code" },
      { agent: { name: "cursor", model: "gpt-5" }, label: "Cursor" },
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
    await runDojo(request, d);

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

  it("drops an agent that can't review, says why, and goes on without it", async () => {
    const d = deps({
      claude: { review: "I looked and it seems fine!" },
      cursor: { review: { findings: [finding("x")] } },
    });

    const result = await runDojo(request, d);

    expect(result.agents[0].error).toMatch(/^couldn't review: didn't answer with a JSON block/);
    expect(result.agents[1].error).toBeUndefined();
    expect(result.findings.map((f) => [f.id, f.consensus])).toEqual([["cursor-1", "solo"]]);
  });

  it("drops an agent that isn't installed", async () => {
    const d = deps({ cursor: { review: { findings: [] } } }, { installed: async (k) => k.name === "cursor" });
    const result = await runDojo(request, d);
    expect(result.agents[0].error).toBe("couldn't start: isn't installed (install claude).");
    expect(d.kinds.claude.begin).not.toHaveBeenCalled();
  });

  it("keeps an agent's findings when only its vote fails", async () => {
    const d = deps({
      claude: { review: { findings: [finding("a")] }, vote: "no json here" },
      cursor: { review: { findings: [finding("b")] }, vote: { votes: [{ findingId: "claude-1", stance: "agree", severity: "major", note: "" }] } },
    });

    const result = await runDojo(request, d);

    expect(result.agents[0].error).toMatch(/^couldn't vote/);
    expect(result.findings.map((f) => [f.id, f.consensus])).toEqual([
      ["claude-1", "agreed"],
      ["cursor-1", "partial"],
    ]);
  });

  it("fails when no agent could review at all", async () => {
    const d = deps({}, { installed: async () => false });
    await expect(runDojo(request, d)).rejects.toThrow(/No agent could review\. Claude Code couldn't start: isn't installed/);
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
