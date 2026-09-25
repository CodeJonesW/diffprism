import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  waitForDecision,
  ReviewerAskedError,
  ReviewTimeoutError,
  lastMessageAt,
  mcpToolPermission,
  recordError,
} from "@diffprism/core";
import type { Annotation, GlobalServerInfo, PrAgentStarter, ReviewResult } from "@diffprism/core";

/**
 * What the agent may do: read the review and the code, and reply. Answering a
 * question about a pull request never needs a file changed.
 */
export const AGENT_ALLOWED_TOOLS = [
  ...[
    "get_review_comments",
    "reply",
    "get_pr_context",
    "get_file_diff",
    "get_file_context",
  ].map(mcpToolPermission),
  "Read",
  "Grep",
  "Glob",
];

/**
 * Denied outright. Allowing only the tools above isn't enough on its own: a
 * permissive default mode in the user's settings would let the rest through.
 */
export const AGENT_DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit", "Bash"];

/** How to start an MCP server: a command and its arguments. */
export interface McpCommand {
  command: string;
  args: string[];
}

/**
 * This build's own `diffprism serve`. The agent talks to the same DiffPrism
 * that opened the review — not whatever a project's .mcp.json launches, which
 * for a dev build is the npm release (#200). execArgv carries tsx's loader
 * when this runs from source.
 */
export function thisBuildsMcpServer(): McpCommand {
  return {
    command: process.execPath,
    args: [...process.execArgv, process.argv[1], "serve"],
  };
}

/** Whether the `claude` command is installed. Without it there is no agent to start. */
export function claudeAvailable(): boolean {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** How the agent's replies are signed in the dashboard. */
export const AGENT_NAME = "Claude Code";

export interface AgentTurn {
  reviewSessionId: string;
  prUrl: string;
  /** Claude Code's conversation id — one per review, so later answers remember earlier ones. */
  conversationId: string;
  /** The first turn starts the conversation; every later one resumes it. */
  first: boolean;
  mcp: McpCommand;
}

export function agentSystemPrompt(turn: AgentTurn): string {
  return [
    `You are answering a code reviewer's questions about ${turn.prUrl}, in DiffPrism review ${turn.reviewSessionId}.`,
    "The reviewer comments on lines in the DiffPrism dashboard and reads your answers there. Nobody reads this terminal.",
    `Answer each thread you are given with mcp__diffprism__reply: its id as annotation_id, session_id "${turn.reviewSessionId}", source_agent "${AGENT_NAME}", and then_wait: false.`,
    "Every thread is on a file and line. Answer about that code: read it first with get_file_diff or get_file_context, and use Read and Grep for the rest of the repository. Keep answers direct and specific.",
    "You can't change files, and you don't need to — this is a conversation about the change.",
    "When every thread has a reply, stop. You'll be called again when the reviewer writes more.",
  ].join("\n");
}

/**
 * The threads themselves, in the prompt: where each one is and what has been
 * said. Told only to go and read them, an agent anchored on whatever else it
 * found first — the file the reviewer happened to have open — rather than the
 * line the question was on.
 */
export function agentPrompt(threads: Annotation[]): string {
  const count = threads.length === 1 ? "1 thread" : `${threads.length} threads`;
  const blocks = threads.map((t) => {
    const messages = [
      { author: t.author ?? "agent", body: t.body },
      ...(t.replies ?? []).map((r) => ({ author: r.author, body: r.body })),
    ];
    return [
      `Thread ${t.id} — ${t.file}, line ${t.line}${t.side === "old" ? " (a removed line)" : ""}:`,
      ...messages.map((m) => `  ${m.author === "reviewer" ? "Reviewer" : "You"}: ${m.body}`),
    ].join("\n");
  });
  return [`The reviewer is waiting on ${count}.`, ...blocks].join("\n\n");
}

/** Arguments for one headless `claude` turn. The prompt goes on stdin. */
export function claudeArgs(turn: AgentTurn): string[] {
  return [
    "-p",
    ...(turn.first ? ["--session-id", turn.conversationId] : ["--resume", turn.conversationId]),
    "--append-system-prompt",
    agentSystemPrompt(turn),
    "--mcp-config",
    JSON.stringify({ mcpServers: { diffprism: turn.mcp } }),
    "--strict-mcp-config",
    "--permission-mode",
    "default",
    "--allowedTools",
    AGENT_ALLOWED_TOOLS.join(","),
    "--disallowedTools",
    AGENT_DISALLOWED_TOOLS.join(","),
  ];
}

export interface ClaudeRun {
  code: number;
  output: string;
}

/** Runs one `claude` turn. Swapped out in tests. */
export type ClaudeRunner = (args: string[], prompt: string, cwd: string) => Promise<ClaudeRun>;

export const runClaude: ClaudeRunner = (args, prompt, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.stdin.end(prompt);
  });

/**
 * Thrown when Claude finishes a turn and a thread it was given is still
 * waiting, untouched. Handing it the same threads again would loop forever.
 */
export class AgentStalledError extends Error {
  constructor(threads: Annotation[], output: string) {
    const n = threads.length === 1 ? "1 thread" : `${threads.length} threads`;
    super(`Claude Code finished without replying to ${n}. Its last output:\n${output.trim() || "(none)"}`);
    this.name = "AgentStalledError";
  }
}

export interface ListenOptions {
  serverInfo: GlobalServerInfo;
  reviewSessionId: string;
  prUrl: string;
  /** Where Claude runs — the local clone when there is one, so it can read whole files. */
  cwd: string;
  mcp: McpCommand;
  /** Claude Code's conversation for this review. Chosen up front, so it can be reported before anything is answered. */
  conversationId: string;
  run?: ClaudeRunner;
  /** How long one wait for a decision lasts before waiting again. */
  waitMs?: number;
  log?: (line: string) => void;
}

export interface ListenOutcome {
  result: ReviewResult;
  /** How many times Claude ran — 0 when nobody asked anything, so there is no conversation to resume. */
  turns: number;
}

/**
 * Keep a Claude Code agent answering the reviewer until they decide.
 *
 * This process does the waiting, not Claude: `waitForDecision` returns the
 * decision, or throws with the threads as soon as the reviewer asks something.
 * Only then does Claude run, for one turn that answers them. So no model time
 * goes on waiting, and the agent doesn't have to remember to keep listening.
 * Reading the threads as an agent is also what tells the dashboard one is
 * listening.
 */
export async function listenWithClaude(options: ListenOptions): Promise<ListenOutcome> {
  const { serverInfo, reviewSessionId, prUrl, cwd, mcp, conversationId } = options;
  const run = options.run ?? runClaude;
  const waitMs = options.waitMs ?? 600_000;
  const log = options.log ?? (() => {});

  let turns = 0;
  let lastOutput = "";
  // Each thread handed to Claude, and when its latest message was written then.
  const handedOver = new Map<string, number>();

  while (true) {
    let threads: Annotation[];
    try {
      const result = await waitForDecision(serverInfo, reviewSessionId, waitMs);
      return { result, turns };
    } catch (err) {
      if (err instanceof ReviewTimeoutError) continue;
      if (!(err instanceof ReviewerAskedError)) throw err;
      threads = err.threads;
    }

    const untouched = threads.filter((t) => handedOver.get(t.id) === lastMessageAt(t));
    if (untouched.length > 0) {
      throw new AgentStalledError(untouched, lastOutput);
    }

    log(`Answering ${threads.length === 1 ? "1 comment" : `${threads.length} comments`}...`);
    const turn: AgentTurn = { reviewSessionId, prUrl, conversationId, first: turns === 0, mcp };
    const { code, output } = await run(claudeArgs(turn), agentPrompt(threads), cwd);
    if (code !== 0) {
      throw new Error(`Claude Code exited with status ${code}:\n${output.trim()}`);
    }
    turns += 1;
    lastOutput = output;
    for (const t of threads) handedOver.set(t.id, lastMessageAt(t));
    log("Answered — see the dashboard.");
  }
}

/**
 * Where an agent runs when the review has no local clone. Its own empty
 * folder, not the server's: the agent's Read and Grep would otherwise browse
 * whatever folder the server happened to start in.
 */
function agentFolder(): string {
  const dir = path.join(os.tmpdir(), "diffprism-agent");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface PrAgentDeps {
  available: () => boolean;
  listen: (options: ListenOptions) => Promise<ListenOutcome>;
  mcp: McpCommand;
  /** Where the agent runs without a local clone. */
  folder: () => string;
  log: (line: string) => void;
}

/**
 * The server's agent starter (#224): one listener per PR review, however the
 * review was opened. It runs inside the server process, so what it says goes
 * to the server's log — `~/.diffprism/server.log` for the background server.
 */
export function prAgentStarter(deps: Partial<PrAgentDeps> = {}): PrAgentStarter {
  const {
    available = claudeAvailable,
    listen = listenWithClaude,
    mcp = thisBuildsMcpServer(),
    folder = agentFolder,
    log = (line: string) => console.log(line),
  } = deps;

  return ({ sessionId, prUrl, localRepoPath, server }) => {
    if (!available()) {
      log(`${sessionId}: Claude Code isn't installed, so no agent will answer comments on ${prUrl}.`);
      return null;
    }

    const conversationId = randomUUID();
    const cwd = localRepoPath ?? folder();
    log(`${sessionId}: Claude Code is answering comments on ${prUrl} (conversation ${conversationId}, in ${cwd}).`);

    const done = listen({
      serverInfo: server,
      reviewSessionId: sessionId,
      prUrl,
      cwd,
      mcp,
      conversationId,
      log: (line) => log(`${sessionId}: ${line}`),
    }).then(
      ({ result }) => log(`${sessionId}: review ${result.decision.replace(/_/g, " ")}; agent stopped.`),
      (err: unknown) => {
        recordError("pr agent", err);
        log(`${sessionId}: agent stopped — ${err instanceof Error ? err.message : String(err)}`);
      },
    );

    return { conversationId, cwd, done };
  };
}
