import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncQueue, recordError } from "@diffprism/core";
import type { FixAgentOutcome, FixAgentStarter, FixableDiffRef, ReviewAgentName } from "@diffprism/core";
import {
  AGENT_KINDS,
  agentFolder,
  agentInstalled,
  listenWithAgent,
  runAgent,
  thisBuildsMcpServer,
} from "./pr-agent.js";
import type {
  AgentConversation,
  AgentKind,
  AgentProcess,
  AgentReview,
  AgentRun,
  AgentRunner,
  ListenOptions,
  ListenOutcome,
  McpCommand,
} from "./pr-agent.js";

const execFileAsync = promisify(execFile);

// ─── An agent the reviewer starts to fix what they sent (#279) ───
//
// A finding sent back on a local review reaches an agent only while one is
// waiting on the review: a `git commit` at the gate, `diffprism review`, or
// open_review. When none is, the reviewer can start one from the dashboard.
// It's the listener every DiffPrism agent uses, with leave to change files in
// the repository (not .git): it waits on the review, fixes each finding it's
// handed without committing, replies Fixed, and stops when the reviewer
// decides. It has no shell, so it can't commit or run a command; on a staged
// review, DiffPrism stages what it changed. What it writes is in the review,
// for the reviewer to judge like any other change.

const REF_WORDS: Record<FixableDiffRef, string> = {
  staged: "its staged changes",
  unstaged: "its unstaged changes",
  "working-copy": "its uncommitted changes",
};

export function fixerSystemPrompt(review: Pick<AgentReview, "reviewSessionId" | "localRepoPath">, label: string, diffRef: FixableDiffRef): string {
  return [
    `You are fixing what a code reviewer sent back on the repository at ${review.localRepoPath} — ${REF_WORDS[diffRef]} — in DiffPrism review ${review.reviewSessionId}.`,
    "The reviewer reads your replies in the DiffPrism dashboard. Nobody reads this terminal.",
    "Each thread you're given is on a file and line. Read the code there first, with the DiffPrism get_file_diff or get_file_context tools and Read, then:",
    "- If it asks for a fix, make the smallest change that fixes it, in that repository. Then reply saying what you changed, with fixed: true.",
    "Change only the files the fix needs. Never touch .git, git hooks, or scripts that run on install or build unless the thread is about them.",
    "- If it isn't a problem, or you can't fix it without the reviewer, reply without fixed and say why.",
    `Reply with the DiffPrism reply tool: the thread's id as annotation_id, session_id "${review.reviewSessionId}", source_agent "${label}", and then_wait: false.`,
    diffRef === "staged"
      ? "Don't commit. You can't run commands, and don't need to: DiffPrism stages what you change, so the review shows it."
      : "Don't commit. You can't run commands, and don't need to: the review shows your changes as you make them.",
    "When every thread has a reply, stop. You'll be called again if the reviewer sends more.",
  ].join("\n");
}

/** Runs git in a repo and resolves with what it printed; rejects when git fails. Swapped out in tests. */
export type GitRunner = (args: string[], cwd: string) => Promise<Buffer>;

const runGit: GitRunner = async (args, cwd) =>
  (await execFileAsync("git", args, { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })).stdout;

/** A file with changes that aren't staged, as it is at one moment. */
export interface UnstagedFile {
  /** Tracked, with unstaged edits; or not tracked at all. */
  tracked: boolean;
  /** A hash of what's in it; "" once it's deleted. */
  hash: string;
  /** What's in it, for a tracked file: what a turn's own change is measured from. */
  content?: Buffer;
}

const names = (out: Buffer) => out.toString("utf8").split("\0").filter(Boolean);

async function readIfThere(file: string): Promise<Buffer | null> {
  try {
    return await fs.promises.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Every file whose working copy differs from what's staged, or that git
 * doesn't track yet. Two of these, before and after a turn, say exactly which
 * files the turn changed, and from what.
 */
export async function unstagedFiles(repoRoot: string, git: GitRunner = runGit): Promise<Map<string, UnstagedFile>> {
  const [modified, untracked] = await Promise.all([
    git(["diff", "--name-only", "-z"], repoRoot),
    git(["ls-files", "--others", "--exclude-standard", "-z"], repoRoot),
  ]);
  const files = new Map<string, UnstagedFile>();
  const hashOf = (content: Buffer | null) => (content ? createHash("sha1").update(content).digest("hex") : "");
  for (const file of names(modified)) {
    const content = await readIfThere(path.join(repoRoot, file));
    files.set(file, { tracked: true, hash: hashOf(content), content: content ?? undefined });
  }
  for (const file of names(untracked)) {
    files.set(file, { tracked: false, hash: hashOf(await readIfThere(path.join(repoRoot, file))) });
  }
  return files;
}

/**
 * Stage one turn's changes, and only them. A file the turn changed that had
 * nothing unstaged before is all the turn's, and is staged whole. One the
 * reviewer had left unstaged edits in gets only the turn's own change on top
 * of what's staged — a three-way merge of the staged copy, the file before
 * the turn, and after — so what they kept out of the commit stays out. Where
 * that can't be told apart, it says so rather than staging their edits.
 */
export async function stageTurn(before: Map<string, UnstagedFile>, repoRoot: string, git: GitRunner = runGit): Promise<void> {
  const after = await unstagedFiles(repoRoot, git);
  for (const [file, now] of after) {
    const was = before.get(file);
    if (was?.hash === now.hash) continue;
    if (!was || now.hash === "") {
      await git(["add", "-A", "--", file], repoRoot);
    } else if (!was.tracked) {
      throw new Error(
        `Couldn't stage ${file}: git doesn't track it, and it wasn't added for this commit, so the review doesn't include it. Add it yourself if it belongs.`,
      );
    } else {
      await stageOwnChange(file, was.content ?? Buffer.alloc(0), repoRoot, git);
    }
  }
}

async function stageOwnChange(file: string, beforeTurn: Buffer, repoRoot: string, git: GitRunner): Promise<void> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diffprism-stage-"));
  try {
    const staged = path.join(dir, "staged");
    const base = path.join(dir, "base");
    const merged = path.join(dir, "merged");
    await fs.promises.writeFile(staged, await git(["show", `:0:${file}`], repoRoot));
    await fs.promises.writeFile(base, beforeTurn);
    let result: Buffer;
    try {
      result = await git(["merge-file", "-p", staged, base, path.join(repoRoot, file)], repoRoot);
    } catch {
      throw new Error(
        `Couldn't stage the fix to ${file}: it overlaps edits you left unstaged there, so staging it would take those too. Stage it yourself.`,
      );
    }
    await fs.promises.writeFile(merged, result);
    const sha = (await git(["hash-object", "-w", "--", merged], repoRoot)).toString("utf8").trim();
    const mode = (await git(["ls-files", "-s", "--", file], repoRoot)).toString("utf8").split(" ")[0];
    await git(["update-index", "--cacheinfo", `${mode},${sha},${file}`], repoRoot);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/**
 * On a staged review, a fix shows up only once it's staged, and the fixer has
 * no shell to stage it with. So each turn is run by this: it notes what's
 * unstaged, runs the turn, then stages what the turn changed (`stageTurn`).
 * A file the reviewer edits during the turn is staged with it; the turn is
 * short, and the review shows it. Nothing here blocks the server: the turn
 * starts once the listing is in.
 */
export function stagingRunner(inner: AgentRunner, repoRoot: string, git: GitRunner = runGit): AgentRunner {
  return (command, invocation, cwd) => {
    const events = new AsyncQueue<unknown>();
    let turn: AgentProcess | undefined;
    let stopped = false;
    const done = (async (): Promise<AgentRun> => {
      try {
        const before = await unstagedFiles(repoRoot, git);
        if (stopped) return { code: 1, output: "Stopped before it started." };
        turn = inner(command, invocation, cwd);
        const started = turn;
        const forwarded = (async () => {
          for await (const event of started.events) events.push(event);
        })();
        const run = await started.done;
        await forwarded;
        // What it changed is staged even if it then failed: the review should show it.
        await stageTurn(before, repoRoot, git);
        return run;
      } finally {
        events.end();
      }
    })();
    return {
      events,
      done,
      kill() {
        stopped = true;
        turn?.kill();
      },
    };
  };
}

export interface FixAgentDeps {
  kinds: Record<ReviewAgentName, AgentKind>;
  installed: (kind: AgentKind) => Promise<boolean>;
  listen: (options: ListenOptions) => Promise<ListenOutcome>;
  run: AgentRunner;
  git: GitRunner;
  mcp: McpCommand;
  folder: (name: string) => string;
  log: (line: string) => void;
}

/**
 * The server's fixer starter (#279): the agent chosen in the settings (#226),
 * fixing a local review's findings until the reviewer decides. It runs inside
 * the server, so it logs to the server's log. It rejects with why when the
 * agent can't start; once started, `done` says how it ended.
 */
export function fixAgentStarter(deps: Partial<FixAgentDeps> = {}): FixAgentStarter {
  const {
    kinds = AGENT_KINDS,
    installed = agentInstalled,
    listen = listenWithAgent,
    run = runAgent,
    git = runGit,
    mcp = thisBuildsMcpServer(),
    folder = agentFolder,
    log = (line: string) => console.log(line),
  } = deps;

  return async ({ sessionId, repoRoot, diffRef, server, agent }) => {
    const kind = kinds[agent.name];
    if (!(await installed(kind))) {
      throw new Error(`${kind.label} isn't installed (${kind.installHint}).`);
    }

    const review: AgentReview = {
      reviewSessionId: sessionId,
      subject: `the local change in ${repoRoot}`,
      localRepoPath: repoRoot,
      model: agent.model,
      mcp,
      // Its own folder, apart from any other agent on this review.
      folder: () => folder(`${sessionId}-fixer`),
      canEdit: true,
    };
    let conversation: AgentConversation;
    try {
      conversation = await kind.begin(review);
    } catch (err) {
      recordError("fix agent", err);
      throw new Error(`${kind.label} couldn't start: ${err instanceof Error ? err.message : String(err)}`);
    }
    log(`${sessionId}: ${kind.label} is fixing what the reviewer sent (conversation ${conversation.id}, in ${conversation.cwd}).`);

    const done: Promise<FixAgentOutcome> = listen({
      serverInfo: server,
      kind,
      review,
      conversation,
      instructions: fixerSystemPrompt(review, kind.label, diffRef),
      run: diffRef === "staged" ? stagingRunner(run, repoRoot, git) : run,
      log: (line) => log(`${sessionId}: ${line}`),
    }).then(
      ({ result }) => {
        log(`${sessionId}: review ${result.decision.replace(/_/g, " ")}; fixer stopped.`);
        return { ok: true } as const;
      },
      (err: unknown) => {
        recordError("fix agent", err);
        const error = err instanceof Error ? err.message : String(err);
        log(`${sessionId}: fixer stopped — ${error}`);
        return { ok: false, error } as const;
      },
    );
    return { label: kind.label, done };
  };
}
