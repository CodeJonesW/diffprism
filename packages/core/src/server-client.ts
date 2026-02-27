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
function buildDefaultSpawnCommand(options: EnsureServerOptions): string[] {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // In dev: packages/core/src -> ../../.. -> cli/bin/diffprism.mjs
  // In published: node_modules/@diffprism/core/dist -> look for node_modules/.bin/diffprism
  const workspaceRoot = path.resolve(thisDir, "..", "..", "..");
  const devBin = path.join(workspaceRoot, "cli", "bin", "diffprism.mjs");

  let binPath: string = "diffprism"; // Fall back to PATH lookup
  if (fs.existsSync(devBin)) {
    binPath = devBin;
  } else {
    // Published mode: walk up looking for node_modules/.bin/diffprism
    let searchDir = thisDir;
    while (searchDir !== path.dirname(searchDir)) {
      const candidate = path.join(
        searchDir,
        "node_modules",
        ".bin",
        "diffprism",
      );
      if (fs.existsSync(candidate)) {
        binPath = candidate;
        break;
      }
      searchDir = path.dirname(searchDir);
    }
  }

  const args = [process.execPath, binPath, "server", "--_daemon"];
  if (options.dev) {
    args.push("--dev");
  }
  return args;
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
 * Submit a review to the global server and wait for the user's decision.
 *
 * If injectedPayload is provided, uses it directly (for GitHub PRs).
 * Otherwise, computes diff locally from diffRef.
 *
 * Returns the ReviewResult once the user submits in the UI.
 */
export async function submitReviewToServer(
  serverInfo: GlobalServerInfo,
  diffRef: string,
  options: SubmitReviewOptions = {},
): Promise<{ result: ReviewResult; sessionId: string }> {
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

  // Poll for result
  const pollIntervalMs = 2000;
  const maxWaitMs = options.timeoutMs ?? 600_000;
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
