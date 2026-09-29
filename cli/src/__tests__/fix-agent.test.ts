import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncQueue } from "@diffprism/core";
import type { GlobalServerInfo } from "@diffprism/core";
import { fixAgentStarter, fixerSystemPrompt, stagingRunner } from "../commands/fix-agent.js";
import { CLAUDE, FIXER_ALLOWED_TOOLS, FIXER_DISALLOWED_TOOLS, cursorFixerPermissions } from "../commands/pr-agent.js";
import type { AgentKind, AgentProcess, AgentReview, AgentRunner, ListenOptions } from "../commands/pr-agent.js";

// ─── #279: an agent the reviewer starts to fix what they sent ───

const serverInfo = { httpPort: 24680, wsPort: 24681, pid: 1, startedAt: 0 } as GlobalServerInfo;
const mcp = { command: "/usr/bin/node", args: ["/cli/bin.js", "serve"] };

function finished(): AgentProcess {
  const events = new AsyncQueue<unknown>();
  events.end();
  return { events, done: Promise.resolve({ code: 0, output: "done" }), kill: () => {} };
}

describe("fixerSystemPrompt", () => {
  const review = { reviewSessionId: "session-9", localRepoPath: "/work/app" };

  it("tells it to fix, reply Fixed, and never commit — and that DiffPrism stages a staged review's fixes", () => {
    const prompt = fixerSystemPrompt(review, "Claude Code", "staged");
    expect(prompt).toContain("/work/app — its staged changes");
    expect(prompt).toContain("with fixed: true");
    expect(prompt).toContain('session_id "session-9", source_agent "Claude Code", and then_wait: false');
    expect(prompt).toContain("Don't commit.");
    expect(prompt).toContain("DiffPrism stages what you change");
  });

  it("says a working-copy review shows changes as they're made", () => {
    expect(fixerSystemPrompt(review, "Cursor", "working-copy")).toContain("the review shows your changes as you make them");
  });
});

describe("a fixer's Claude Code", () => {
  it("may edit files in the repository but not .git, and still has no shell", () => {
    const review: AgentReview = { reviewSessionId: "s", subject: "x", localRepoPath: "/work/app", mcp, folder: () => "/tmp/f", canEdit: true };
    const { args } = CLAUDE.turn(review, { id: "c", cwd: "/work/app", resumeCommand: "" }, { first: true, prompt: "p", instructions: "i" });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(FIXER_ALLOWED_TOOLS.join(","));
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(FIXER_DISALLOWED_TOOLS.join(","));
    // Its working directory is the repository: edits are scoped to it.
    expect(FIXER_ALLOWED_TOOLS).toEqual(expect.arrayContaining(["Edit(./**)", "Write(./**)"]));
    expect(FIXER_ALLOWED_TOOLS).not.toContain("Edit");
    expect(FIXER_DISALLOWED_TOOLS).toEqual(expect.arrayContaining(["Bash", "Edit(./.git/**)", "Write(./.git/**)"]));
  });

  it("gives Cursor's fixer the repository to write in, not .git, and no shell", () => {
    expect(cursorFixerPermissions("/work/app")).toEqual({
      permissions: {
        allow: ["Read(**)", "Write(/work/app/**)", "Mcp(diffprism:*)"],
        deny: ["Shell(*)", "Write(/work/app/.git/**)"],
      },
    });
  });
});

describe("stagingRunner", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "fix-agent-"));
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(repo, "a.ts"), "a\n");
    fs.writeFileSync(path.join(repo, "b.ts"), "b\n");
    fs.writeFileSync(path.join(repo, "gone.ts"), "gone\n");
    git("add", ".");
    git("commit", "-qm", "base");
    // The reviewer's own unstaged edit, which isn't the fixer's to stage.
    fs.writeFileSync(path.join(repo, "b.ts"), "b, mine\n");
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("stages exactly what the turn changed — edits, new files and deletions — and leaves the rest unstaged", async () => {
    const turn: AgentRunner = () => {
      fs.writeFileSync(path.join(repo, "a.ts"), "a, fixed\n");
      fs.writeFileSync(path.join(repo, "new.ts"), "new\n");
      fs.rmSync(path.join(repo, "gone.ts"));
      return finished();
    };

    await stagingRunner(turn, repo)("claude", { args: [] }, repo).done;

    expect(git("diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(["a.ts", "gone.ts", "new.ts"]);
    expect(git("diff", "--name-only").trim()).toBe("b.ts");
  });

  it("stages only its own change to a file the reviewer left unstaged edits in", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(repo, "long.ts"), lines.join("\n") + "\n");
    git("add", "long.ts");
    git("commit", "-qm", "long");
    // The reviewer's debug line near the top, deliberately unstaged.
    const mine = [...lines];
    mine[1] = "line 2 // debug, not for this commit";
    fs.writeFileSync(path.join(repo, "long.ts"), mine.join("\n") + "\n");

    const turn: AgentRunner = () => {
      const fixed = [...mine];
      fixed[17] = "line 18, fixed";
      fs.writeFileSync(path.join(repo, "long.ts"), fixed.join("\n") + "\n");
      return finished();
    };
    await stagingRunner(turn, repo)("claude", { args: [] }, repo).done;

    const staged = git("show", ":0:long.ts");
    expect(staged).toContain("line 18, fixed");
    expect(staged).not.toContain("debug");
    // Still in the working copy, still unstaged.
    expect(git("diff", "--", "long.ts")).toContain("debug, not for this commit");
  });

  it("says so, and stages nothing of the reviewer's, when its change overlaps edits they left unstaged", async () => {
    const turn: AgentRunner = () => {
      fs.writeFileSync(path.join(repo, "b.ts"), "b, mine, fixed\n");
      return finished();
    };
    await expect(stagingRunner(turn, repo)("claude", { args: [] }, repo).done).rejects.toThrow(
      "Couldn't stage the fix to b.ts: it overlaps edits you left unstaged there",
    );
    expect(git("diff", "--cached", "--name-only").trim()).toBe("");
  });

  it("says so rather than adding a file the reviewer hadn't added", async () => {
    fs.writeFileSync(path.join(repo, "notes.md"), "mine\n");
    const turn: AgentRunner = () => {
      fs.writeFileSync(path.join(repo, "notes.md"), "mine, fixed\n");
      return finished();
    };
    await expect(stagingRunner(turn, repo)("claude", { args: [] }, repo).done).rejects.toThrow("Couldn't stage notes.md: git doesn't track it");
  });

  it("doesn't start a turn it was stopped before", async () => {
    const inner = vi.fn<AgentRunner>(() => finished());
    const turn = stagingRunner(inner, repo)("claude", { args: [] }, repo);
    turn.kill();
    expect(await turn.done).toEqual({ code: 1, output: "Stopped before it started." });
    expect(inner).not.toHaveBeenCalled();
  });
});

describe("fixAgentStarter", () => {
  const kind = { ...CLAUDE, begin: async () => ({ id: "conv-1", cwd: "/work/app", resumeCommand: "" }) } as AgentKind;
  const request = { sessionId: "session-9", repoRoot: "/work/app", diffRef: "staged" as const, server: serverInfo, agent: { name: "claude" as const, model: "opus" } };

  it("starts the chosen agent able to edit, told to fix, and says how it ended", async () => {
    const listen = vi.fn(async (_options: ListenOptions) => ({ result: { decision: "approved" as const, comments: [] }, turns: 1 }));
    const start = fixAgentStarter({ kinds: { claude: kind, cursor: kind }, installed: async () => true, listen, mcp, folder: (n) => `/tmp/${n}`, log: () => {} });

    const handle = await start(request);

    expect(handle.label).toBe("Claude Code");
    expect(await handle.done).toEqual({ ok: true });
    const options = listen.mock.calls[0][0];
    expect(options.review).toMatchObject({ reviewSessionId: "session-9", localRepoPath: "/work/app", model: "opus", canEdit: true });
    expect(options.review.folder()).toBe("/tmp/session-9-fixer");
    expect(options.instructions).toBe(fixerSystemPrompt(options.review, "Claude Code", "staged"));
    expect(options.run).toBeDefined();
  });

  it("stages only on a staged review: a working-copy review shows fixes as they're made", async () => {
    const listen = vi.fn(async (_options: ListenOptions) => ({ result: { decision: "approved" as const, comments: [] }, turns: 0 }));
    const run: AgentRunner = () => finished();
    const start = fixAgentStarter({ kinds: { claude: kind, cursor: kind }, installed: async () => true, listen, run, mcp, folder: () => "/tmp/f", log: () => {} });
    await start({ ...request, diffRef: "working-copy" });
    expect(listen.mock.calls[0][0].run).toBe(run);
  });

  it("says why it stopped when it can't go on, and why it can't start when the agent isn't installed", async () => {
    const listen = vi.fn(async () => {
      throw new Error("Claude Code finished without replying to 1 thread.");
    });
    const start = fixAgentStarter({ kinds: { claude: kind, cursor: kind }, installed: async () => true, listen, mcp, folder: () => "/tmp/f", log: () => {} });
    expect(await (await start(request)).done).toEqual({ ok: false, error: "Claude Code finished without replying to 1 thread." });

    const missing = fixAgentStarter({ kinds: { claude: kind, cursor: kind }, installed: async () => false, listen, mcp, folder: () => "/tmp/f", log: () => {} });
    await expect(missing(request)).rejects.toThrow("Claude Code isn't installed");
  });
});
