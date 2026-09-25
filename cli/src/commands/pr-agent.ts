import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
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
import type {
  Annotation,
  GlobalServerInfo,
  PrAgentStarter,
  ReviewAgentChoice,
  ReviewAgentName,
  ReviewResult,
} from "@diffprism/core";

/**
 * What a Claude Code agent may do: read the review and the code, and reply.
 * Answering a question about a pull request never needs a file changed.
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

/** Quote a path for a shell command the reviewer will paste. */
function shellPath(p: string): string {
  return /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p;
}

// ─── One conversation about one review ───

/** What an agent is answering. */
export interface AgentReview {
  reviewSessionId: string;
  prUrl: string;
  /** The local clone the review reads from, or null when there isn't one. */
  localRepoPath: string | null;
  model?: string;
  mcp: McpCommand;
  /** A folder of the agent's own for this review, created on demand. */
  folder: () => string;
}

/** A conversation an agent has started about a review. */
export interface AgentConversation {
  id: string;
  /** Where each turn runs. */
  cwd: string;
  /** The shell command that continues it in a terminal, from any folder. */
  resumeCommand: string;
}

/** One turn: what to run, and what to send on stdin, if anything. */
export interface AgentInvocation {
  args: string[];
  stdin?: string;
}

/**
 * One kind of agent that can answer a review (#226). Each says how to start a
 * conversation and how to run one turn of it; the listener does the rest the
 * same way for all of them.
 */
export interface AgentKind {
  name: ReviewAgentName;
  /** How it signs its replies in the dashboard. */
  label: string;
  /** The command it runs as. */
  command: string;
  /** How to install it, for the message when it isn't. */
  installHint: string;
  /** Start a conversation. Asynchronous, so a slow start never holds up the server. */
  begin(review: AgentReview): Promise<AgentConversation>;
  turn(review: AgentReview, conversation: AgentConversation, turn: { first: boolean; prompt: string }): AgentInvocation;
}

export function agentSystemPrompt(review: Pick<AgentReview, "reviewSessionId" | "prUrl">, label: string): string {
  return [
    `You are answering a code reviewer's questions about ${review.prUrl}, in DiffPrism review ${review.reviewSessionId}.`,
    "The reviewer comments on lines in the DiffPrism dashboard and reads your answers there. Nobody reads this terminal.",
    `Answer each thread you are given with the DiffPrism reply tool: its id as annotation_id, session_id "${review.reviewSessionId}", source_agent "${label}", and then_wait: false.`,
    "Every thread is on a file and line. Answer about that code: read it first with the DiffPrism get_file_diff or get_file_context tools, and read the rest of the repository as you need to. Keep answers direct and specific.",
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

// ─── Claude Code ───

export const CLAUDE: AgentKind = {
  name: "claude",
  label: "Claude Code",
  command: "claude",
  installHint: "https://claude.com/claude-code",

  // Claude Code lets us name the conversation up front, and keeps it with the
  // folder it ran in: the clone when there is one, so it can read whole files.
  async begin(review) {
    const id = randomUUID();
    const cwd = review.localRepoPath ?? review.folder();
    return { id, cwd, resumeCommand: `cd ${shellPath(cwd)} && claude --resume ${id}` };
  },

  turn(review, conversation, { first, prompt }) {
    return {
      args: [
        "-p",
        ...(first ? ["--session-id", conversation.id] : ["--resume", conversation.id]),
        ...(review.model ? ["--model", review.model] : []),
        "--append-system-prompt",
        agentSystemPrompt(review, CLAUDE.label),
        "--mcp-config",
        JSON.stringify({ mcpServers: { diffprism: review.mcp } }),
        "--strict-mcp-config",
        "--permission-mode",
        "default",
        "--allowedTools",
        AGENT_ALLOWED_TOOLS.join(","),
        "--disallowedTools",
        AGENT_DISALLOWED_TOOLS.join(","),
      ],
      stdin: prompt,
    };
  },
};

// ─── Cursor ───

/**
 * What a Cursor agent may do, in its workspace's .cursor/cli.json: read
 * anything, use the DiffPrism tools — replying included — and nothing else.
 * No file is written and no command runs, in its own folder or the clone.
 */
export const CURSOR_PERMISSIONS = {
  permissions: {
    allow: ["Read(**)", "Mcp(diffprism:*)"],
    deny: ["Shell(*)", "Write(**)"],
  },
};

export const CURSOR: AgentKind = {
  name: "cursor",
  label: "Cursor",
  command: "cursor-agent",
  installHint: "run `cursor agent` once, then `cursor-agent login`",

  // Cursor reads MCP servers and permissions only from files in its
  // workspace's .cursor folder, with no flags to pass them. So its workspace
  // is a folder of its own holding those files — a reviewer's clone never gets
  // one written into it — and the clone is added to what it can read. Cursor
  // names the conversation itself.
  async begin(review) {
    // Not logged in, Cursor opens a chat anyway and then waits indefinitely.
    // Asking first turns that into a message that says what to do.
    const { stdout } = await execFileAsync("cursor-agent", ["status", "--format", "json"], { timeout: 30_000 });
    const status = JSON.parse(stdout) as { isAuthenticated?: boolean };
    if (!status.isAuthenticated) {
      throw new Error("Cursor isn't logged in. Run `cursor-agent login` once, then open the review again.");
    }

    const cwd = review.folder();
    fs.mkdirSync(path.join(cwd, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { diffprism: review.mcp } }, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(cwd, ".cursor", "cli.json"), JSON.stringify(CURSOR_PERMISSIONS, null, 2) + "\n");
    const id = await firstLine("cursor-agent", ["create-chat"], cwd, /^[\w-]{8,}$/);
    return { id, cwd, resumeCommand: `cd ${shellPath(cwd)} && cursor-agent --resume ${id}` };
  },

  // Read-only comes from the permissions file begin() writes, not from ask
  // mode: ask mode counts posting a reply as a write and refuses it, so an
  // agent in it could answer only into a log nobody reads. There is no
  // separate system prompt, so the instructions lead the first turn.
  turn(review, conversation, { first, prompt }) {
    return {
      args: [
        "-p",
        "--resume",
        conversation.id,
        "--workspace",
        conversation.cwd,
        ...(review.localRepoPath ? ["--add-dir", review.localRepoPath] : []),
        "--trust",
        "--approve-mcps",
        ...(review.model ? ["--model", review.model] : []),
        "--output-format",
        "text",
        first ? `${agentSystemPrompt(review, CURSOR.label)}\n\n${prompt}` : prompt,
      ],
    };
  },
};

export const AGENT_KINDS: Record<ReviewAgentName, AgentKind> = { claude: CLAUDE, cursor: CURSOR };

const execFileAsync = promisify(execFile);

/**
 * The first line a command prints that matches, then the command is stopped.
 * `cursor-agent create-chat` prints its chat id and then doesn't exit, so
 * waiting for it to finish would wait forever.
 */
function firstLine(command: string, args: string[], cwd: string, match: RegExp, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const finish = (err: Error | null, line?: string): void => {
      clearTimeout(timer);
      child.kill();
      if (err) reject(err);
      else resolve(line!);
    };
    const timer = setTimeout(
      () => finish(new Error(`${command} ${args.join(" ")} printed nothing usable in ${timeoutMs / 1000}s:\n${output.trim()}`)),
      timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output.split("\n").map((l) => l.trim()).find((l) => match.test(l));
      if (line) finish(null, line);
    });
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (err) => finish(err));
    child.on("close", (code) => finish(new Error(`${command} ${args.join(" ")} exited with status ${code}:\n${output.trim()}`)));
  });
}

/** Whether an agent's command is installed. Without it there is no agent to start. */
export async function agentInstalled(kind: AgentKind): Promise<boolean> {
  try {
    await execFileAsync(kind.command, ["--version"], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Running turns ───

export interface AgentRun {
  code: number;
  output: string;
}

/** Runs one turn. Swapped out in tests. */
export type AgentRunner = (command: string, invocation: AgentInvocation, cwd: string) => Promise<AgentRun>;

export const runAgent: AgentRunner = (command, { args, stdin }, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.stdin.end(stdin ?? "");
  });

/**
 * Thrown when the agent finishes a turn and a thread it was given is still
 * waiting, untouched. Handing it the same threads again would loop forever.
 */
export class AgentStalledError extends Error {
  constructor(label: string, threads: Annotation[], output: string) {
    const n = threads.length === 1 ? "1 thread" : `${threads.length} threads`;
    super(`${label} finished without replying to ${n}. Its last output:\n${output.trim() || "(none)"}`);
    this.name = "AgentStalledError";
  }
}

export interface ListenOptions {
  serverInfo: GlobalServerInfo;
  kind: AgentKind;
  review: AgentReview;
  conversation: AgentConversation;
  run?: AgentRunner;
  /** How long one wait for a decision lasts before waiting again. */
  waitMs?: number;
  log?: (line: string) => void;
}

export interface ListenOutcome {
  result: ReviewResult;
  /** How many times the agent ran — 0 when nobody asked anything, so there is no conversation to resume. */
  turns: number;
}

/**
 * Keep an agent answering the reviewer until they decide.
 *
 * This process does the waiting, not the agent: `waitForDecision` returns the
 * decision, or throws with the threads as soon as the reviewer asks something.
 * Only then does the agent run, for one turn that answers them. So no model
 * time goes on waiting, and the agent doesn't have to remember to keep
 * listening. Reading the threads as an agent is also what tells the dashboard
 * one is listening.
 */
export async function listenWithAgent(options: ListenOptions): Promise<ListenOutcome> {
  const { serverInfo, kind, review, conversation } = options;
  const run = options.run ?? runAgent;
  const waitMs = options.waitMs ?? 600_000;
  const log = options.log ?? (() => {});

  let turns = 0;
  let lastOutput = "";
  // Each thread handed to the agent, and when its latest message was written then.
  const handedOver = new Map<string, number>();

  while (true) {
    let threads: Annotation[];
    try {
      const result = await waitForDecision(serverInfo, review.reviewSessionId, waitMs);
      return { result, turns };
    } catch (err) {
      if (err instanceof ReviewTimeoutError) continue;
      if (!(err instanceof ReviewerAskedError)) throw err;
      threads = err.threads;
    }

    const untouched = threads.filter((t) => handedOver.get(t.id) === lastMessageAt(t));
    if (untouched.length > 0) {
      throw new AgentStalledError(kind.label, untouched, lastOutput);
    }

    log(`Answering ${threads.length === 1 ? "1 comment" : `${threads.length} comments`}...`);
    const invocation = kind.turn(review, conversation, { first: turns === 0, prompt: agentPrompt(threads) });
    const { code, output } = await run(kind.command, invocation, conversation.cwd);
    if (code !== 0) {
      throw new Error(`${kind.label} exited with status ${code}:\n${output.trim()}`);
    }
    turns += 1;
    lastOutput = output;
    for (const t of threads) handedOver.set(t.id, lastMessageAt(t));
    log("Answered — see the dashboard.");
  }
}

// ─── The server's starter ───

/**
 * A folder of the agent's own for one review. Not the server's: an agent's
 * read tools would otherwise browse whatever folder the server happened to
 * start in. One per review, because Cursor keeps its settings there.
 */
function agentFolder(reviewSessionId: string): string {
  const dir = path.join(os.tmpdir(), "diffprism-agent", reviewSessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface PrAgentDeps {
  kinds: Record<ReviewAgentName, AgentKind>;
  installed: (kind: AgentKind) => Promise<boolean>;
  listen: (options: ListenOptions) => Promise<ListenOutcome>;
  mcp: McpCommand;
  folder: (reviewSessionId: string) => string;
  log: (line: string) => void;
}

/**
 * The server's agent starter (#224): one listener per PR review, however the
 * review was opened, running the agent chosen for it (#226). It runs inside
 * the server process, so what it says goes to the server's log —
 * `~/.diffprism/server.log` for the background server. When no agent can
 * start, it rejects with why, which reaches whoever opened the review.
 */
export function prAgentStarter(deps: Partial<PrAgentDeps> = {}): PrAgentStarter {
  const {
    kinds = AGENT_KINDS,
    installed = agentInstalled,
    listen = listenWithAgent,
    mcp = thisBuildsMcpServer(),
    folder = agentFolder,
    log = (line: string) => console.log(line),
  } = deps;

  return async ({ sessionId, prUrl, localRepoPath, server, agent }) => {
    const kind = kinds[agent.name];
    if (!(await installed(kind))) {
      const reason = `${kind.label} isn't installed (${kind.installHint}).`;
      log(`${sessionId}: ${reason} No agent will answer comments on ${prUrl}.`);
      throw new Error(reason);
    }

    const review: AgentReview = {
      reviewSessionId: sessionId,
      prUrl,
      localRepoPath,
      model: agent.model,
      mcp,
      folder: () => folder(sessionId),
    };
    // Starting can fail on its own — Cursor has to be logged in to start a chat.
    let conversation: AgentConversation;
    try {
      conversation = await kind.begin(review);
    } catch (err) {
      recordError("pr agent", err);
      const reason = err instanceof Error ? err.message : String(err);
      log(`${sessionId}: ${kind.label} couldn't start — ${reason}`);
      throw new Error(`${kind.label} couldn't start: ${reason}`);
    }

    const model = agent.model ? `, model ${agent.model}` : "";
    log(`${sessionId}: ${kind.label} is answering comments on ${prUrl} (conversation ${conversation.id}${model}, in ${conversation.cwd}).`);

    const done = listen({
      serverInfo: server,
      kind,
      review,
      conversation,
      log: (line) => log(`${sessionId}: ${line}`),
    }).then(
      ({ result }) => log(`${sessionId}: review ${result.decision.replace(/_/g, " ")}; agent stopped.`),
      (err: unknown) => {
        recordError("pr agent", err);
        log(`${sessionId}: agent stopped — ${err instanceof Error ? err.message : String(err)}`);
      },
    );

    const choice: ReviewAgentChoice = agent;
    return {
      agent: choice,
      label: kind.label,
      conversationId: conversation.id,
      cwd: conversation.cwd,
      resumeCommand: conversation.resumeCommand,
      done,
    };
  };
}
