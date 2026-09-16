import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { isServerAlive } from "./server-file.js";
import type {
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
  // 1. Check if already running
  const existing = await isServerAlive();
  if (existing) {
    return existing;
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
 * Otherwise, polls until the user submits in the UI or the timeout expires.
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

  // Poll for result
  const pollIntervalMs = 2000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const resultResponse = await fetch(
      `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/result`,
    );

    if (resultResponse.ok) {
      const data = (await resultResponse.json()) as {
        result: ReviewResult | null;
        status: string;
      };

      if (data.result) {
        return { result: data.result, sessionId };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Review timed out waiting for submission.");
}
