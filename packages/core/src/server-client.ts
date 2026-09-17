import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { isServerAlive, readServerFile, removeServerFile } from "./server-file.js";
import { builtAt } from "./build-info.js";
import { awaitingAgent } from "./threads.js";
import type {
  Annotation,
  GlobalServerInfo,
  ReviewInitPayload,
  ReviewResult,
} from "./types.js";

// ─── ensureServer ───

export interface EnsureServerOptions {
  /** Override the spawn command. If omitted, auto-detects. */
  spawnCommand?: string[];
  /** Pass --dev to the spawned server. */
  dev?: boolean;
  /** Maximum time to wait for server startup (ms). Default: 15000. */
  timeoutMs?: number;
  /** Suppress console output. */
  silent?: boolean;
}

/**
 * Ensure a global DiffPrism server is running.
 * If one is already alive, returns its info immediately.
 * If not, spawns one as a background daemon and waits for it to be ready.
 */
export async function ensureServer(
  options: EnsureServerOptions = {},
): Promise<GlobalServerInfo> {
  // 1. Check if already running — and whether it runs this build
  const existing = await isServerAlive();
  if (existing) {
    const decision = await decideOnRunningServer(existing, builtAt());
    if (decision.action === "keep") {
      return existing;
    }
    if (decision.action === "keep-busy") {
      if (!options.silent) {
        console.error(
          `The DiffPrism server (PID ${existing.pid}) runs an older build, but ${decision.openReviews} review${decision.openReviews === 1 ? " is" : "s are"} open in it, so it stays up. Finish or close ${decision.openReviews === 1 ? "it" : "them"} and the next command starts the new build — or run \`diffprism server stop\`.`,
        );
      }
      return existing;
    }
    if (!options.silent) {
      console.error(`Replacing the DiffPrism server (PID ${existing.pid}): it runs an older build than this command.`);
    }
    await stopServer(existing);
  }

  // 2. Build spawn command
  const spawnArgs = options.spawnCommand ?? buildDefaultSpawnCommand(options);

  // 3. Ensure log directory
  const logDir = path.join(os.homedir(), ".diffprism");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logPath = path.join(logDir, "server.log");
  const logFd = fs.openSync(logPath, "a");

  // 4. Spawn detached daemon
  const [cmd, ...args] = spawnArgs;
  const child = spawn(cmd, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  child.unref();
  fs.closeSync(logFd);

  // 5. Poll for readiness
  const timeoutMs = options.timeoutMs ?? 15_000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const info = await isServerAlive();
    if (info) {
      return info;
    }
  }

  throw new Error(
    `DiffPrism server failed to start within ${timeoutMs / 1000}s. Check logs at ${logPath}`,
  );
}

export type RunningServerDecision =
  | { action: "keep" }
  | { action: "keep-busy"; openReviews: number }
  | { action: "replace" };

/**
 * Decide whether a running server should be replaced by this build.
 *
 * Only an OLDER server is replaced. Claude Code keeps `diffprism serve` running
 * on whatever build it started with; if merely being different were enough,
 * that stale process would restart a newer server back onto its old build.
 * Without a build stamp on this side (running from source) nothing can be
 * compared, so the server is kept. A server with no stamp predates stamps and
 * is older by definition.
 *
 * A review in progress is never cut off: its session lives in the server.
 */
export async function decideOnRunningServer(
  server: GlobalServerInfo,
  ownBuiltAt: number | null,
): Promise<RunningServerDecision> {
  if (ownBuiltAt === null) return { action: "keep" };
  if (server.builtAt !== undefined && server.builtAt >= ownBuiltAt) return { action: "keep" };

  const response = await fetch(`http://localhost:${server.httpPort}/api/reviews`);
  if (!response.ok) {
    throw new Error(`Could not list reviews on the running DiffPrism server: it returned ${response.status}`);
  }
  const { sessions } = (await response.json()) as { sessions: Array<{ status: string }> };
  const openReviews = sessions.filter((s) => s.status === "pending" || s.status === "in_review").length;
  return openReviews > 0 ? { action: "keep-busy", openReviews } : { action: "replace" };
}

/**
 * Stop a running server and wait until it is gone, so a replacement can take
 * its ports. Throws if it outlives the wait rather than racing it for them.
 */
export async function stopServer(server: GlobalServerInfo, timeoutMs = 5000): Promise<void> {
  try {
    process.kill(server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(server.pid)) {
      // A server that died without cleaning up leaves its file behind.
      if (readServerFile()?.pid === server.pid) {
        removeServerFile();
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `The old DiffPrism server (PID ${server.pid}) did not stop within ${timeoutMs / 1000}s. Stop it with \`diffprism server stop\` and try again.`,
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the default spawn command for the daemon.
 * Resolves the diffprism CLI entry point relative to this package.
 */
export function buildDefaultSpawnCommand(
  options: EnsureServerOptions,
): string[] {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // In dev: packages/core/src -> ../../.. -> cli/bin/diffprism.mjs
  const workspaceRoot = path.resolve(thisDir, "..", "..", "..");
  const devBin = path.join(workspaceRoot, "cli", "bin", "diffprism.mjs");
  if (fs.existsSync(devBin)) {
    return withDevFlag([process.execPath, devBin, "server", "--_daemon"], options);
  }

  let searchDir = thisDir;
  while (searchDir !== path.dirname(searchDir)) {
    // Preferred: the package we are running from declares its own bin, which
    // is a real JS entry point node can execute. A global install has nothing
    // else — npm links the executable from the prefix's bin directory, which
    // is nowhere above this file.
    const ownBin = readOwnBinPath(searchDir);
    if (ownBin) {
      return withDevFlag(
        [process.execPath, ownBin, "server", "--_daemon"],
        options,
      );
    }

    // Otherwise a local install's shim. This is NOT a JS file — npm writes a
    // shell script — so it has to be executed directly. Handing it to node
    // makes node parse shell as JavaScript and die on `basedir=$(dirname ...)`.
    const shim = path.join(searchDir, "node_modules", ".bin", "diffprism");
    if (fs.existsSync(shim)) {
      return withDevFlag([shim, "server", "--_daemon"], options);
    }

    searchDir = path.dirname(searchDir);
  }

  // Last resort: let the OS resolve it on PATH. Also spawned directly —
  // passing a bare name as an argument to node makes node resolve it against
  // the current working directory instead, which is how this used to fail
  // with "Cannot find module '<cwd>/diffprism'".
  return withDevFlag(["diffprism", "server", "--_daemon"], options);
}

function withDevFlag(args: string[], options: EnsureServerOptions): string[] {
  return options.dev ? [...args, "--dev"] : args;
}

/**
 * If `dir` is the root of the diffprism package, return the absolute path to
 * the bin entry declared in its own package.json. Returns null otherwise.
 */
function readOwnBinPath(dir: string): string | null {
  const manifestPath = path.join(dir, "package.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const entry =
      typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.diffprism;
    if (!entry) {
      return null;
    }

    const resolved = path.resolve(dir, entry);
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    // A malformed package.json above us is not our problem to report — it just
    // means this directory is not the answer.
    return null;
  }
}

// ─── submitReviewToServer ───

/**
 * Thrown when a blocking review is still open when the wait expires.
 *
 * The session is not gone — the reviewer simply has not decided yet — so the
 * caller gets its id back and can check again later instead of losing track
 * of a review that is still sitting in someone's browser.
 */
export class ReviewTimeoutError extends Error {
  readonly sessionId: string;
  readonly waitedMs: number;

  constructor(sessionId: string, waitedMs: number) {
    super(
      `Review ${sessionId} is still open after ${Math.round(waitedMs / 1000)}s without a decision.`,
    );
    this.name = "ReviewTimeoutError";
    this.sessionId = sessionId;
    this.waitedMs = waitedMs;
  }
}

/**
 * Thrown when a wait for a decision ends because the reviewer asked the agent
 * something first.
 *
 * Whoever is waiting is usually the agent the question is for, and while it
 * waits it can't answer. So the wait hands the threads back: answer each with
 * a reply, then wait again — the review stays open, and a decision still comes.
 */
export class ReviewerAskedError extends Error {
  readonly sessionId: string;
  readonly threads: Annotation[];

  constructor(sessionId: string, threads: Annotation[]) {
    super(
      `The reviewer asked ${threads.length} question${threads.length === 1 ? "" : "s"} on review ${sessionId} before deciding.`,
    );
    this.name = "ReviewerAskedError";
    this.sessionId = sessionId;
    this.threads = threads;
  }
}

/**
 * Wait for the reviewer's decision on an open review.
 *
 * Returns the decision. Throws ReviewerAskedError as soon as a thread is
 * waiting on the agent, and ReviewTimeoutError when maxWaitMs runs out.
 */
export async function waitForDecision(
  serverInfo: GlobalServerInfo,
  sessionId: string,
  maxWaitMs: number,
  pollIntervalMs = 2000,
): Promise<ReviewResult> {
  const base = `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}`;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const resultResponse = await fetch(`${base}/result`);
    if (!resultResponse.ok) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const { result } = (await resultResponse.json()) as { result: ReviewResult | null };
    if (result) {
      return result;
    }

    const annotationsResponse = await fetch(`${base}/annotations`);
    if (!annotationsResponse.ok) {
      throw new Error(`Could not read threads for ${sessionId}: server returned ${annotationsResponse.status}`);
    }
    const { annotations } = (await annotationsResponse.json()) as { annotations: Annotation[] };
    const asked = annotations.filter(awaitingAgent);
    if (asked.length > 0) {
      throw new ReviewerAskedError(sessionId, asked);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new ReviewTimeoutError(sessionId, maxWaitMs);
}

export interface SubmitReviewOptions {
  title?: string;
  description?: string;
  reasoning?: string;
  cwd?: string;
  annotations?: Array<{
    file: string;
    line: number;
    body: string;
    type: "finding" | "suggestion" | "question" | "warning";
    confidence?: number;
    category?: string;
    source_agent?: string;
  }>;
  /** Pre-computed payload (e.g., GitHub PR). Skips local getDiff/analyze. */
  injectedPayload?: ReviewInitPayload;
  /** Project path for the server session (defaults to cwd). */
  projectPath?: string;
  /** Diff ref for the server (used for watch mode). */
  diffRef?: string;
  /** Maximum time to wait for review submission (ms). Default: 600000 (10 min). */
  timeoutMs?: number;
}

/**
 * Submit a review to the global server.
 *
 * If injectedPayload is provided, uses it directly (for GitHub PRs).
 * Otherwise, computes diff locally from diffRef.
 *
 * When timeoutMs is 0, returns immediately after session creation (non-blocking).
 * Otherwise waits with waitForDecision, and throws what it throws.
 */
export async function submitReviewToServer(
  serverInfo: GlobalServerInfo,
  diffRef: string,
  options: SubmitReviewOptions = {},
): Promise<{ result: ReviewResult | null; sessionId: string }> {
  const cwd = options.cwd ?? process.cwd();
  const projectPath = options.projectPath ?? cwd;

  let payload: ReviewInitPayload;

  if (options.injectedPayload) {
    payload = options.injectedPayload;
  } else {
    // Compute diff and analysis locally
    // Dynamic import to avoid loading git/analysis at module level
    // (keeps ensureServer() lightweight for MCP cold starts)
    const { getDiff, getCurrentBranch, detectWorktree } = await import(
      "@diffprism/git"
    );
    const { analyze } = await import("@diffprism/analysis");

    const { diffSet, rawDiff } = getDiff(diffRef, { cwd });

    if (diffSet.files.length === 0) {
      return {
        result: {
          decision: "approved",
          comments: [],
          summary: "No changes to review.",
        },
        sessionId: "",
      };
    }

    const briefing = analyze(diffSet);
    const currentBranch = getCurrentBranch({ cwd });
    const worktreeInfo = detectWorktree({ cwd });

    payload = {
      reviewId: "", // Server assigns the real ID
      diffSet,
      rawDiff,
      briefing,
      metadata: {
        title: options.title,
        description: options.description,
        reasoning: options.reasoning,
        currentBranch,
        worktree: worktreeInfo.isWorktree
          ? {
              isWorktree: true,
              worktreePath: worktreeInfo.worktreePath,
              mainWorktreePath: worktreeInfo.mainWorktreePath,
            }
          : undefined,
      },
    };
  }

  // POST to global server
  const createResponse = await fetch(
    `http://localhost:${serverInfo.httpPort}/api/reviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload,
        projectPath,
        diffRef: options.diffRef ?? diffRef,
      }),
    },
  );

  if (!createResponse.ok) {
    throw new Error(
      `Global server returned ${createResponse.status} on create`,
    );
  }

  const { sessionId } = (await createResponse.json()) as {
    sessionId: string;
  };

  // POST initial annotations if provided
  if (options.annotations?.length) {
    for (const ann of options.annotations) {
      await fetch(
        `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: ann.file,
            line: ann.line,
            body: ann.body,
            type: ann.type,
            confidence: ann.confidence ?? 1,
            category: ann.category ?? "other",
            source: {
              agent: ann.source_agent ?? "unknown",
              tool: "open_review",
            },
          }),
        },
      );
    }
  }

  // Non-blocking mode: return immediately after session creation
  const maxWaitMs = options.timeoutMs ?? 600_000;
  if (maxWaitMs <= 0) {
    return { result: null, sessionId };
  }

  return { result: await waitForDecision(serverInfo, sessionId, maxWaitMs), sessionId };
}
