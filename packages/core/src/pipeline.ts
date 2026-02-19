import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import getPort from "get-port";
import open from "open";
import { fileURLToPath } from "node:url";

import { getDiff, getCurrentBranch } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type { ReviewResult, ReviewOptions, ReviewInitPayload } from "./types.js";
import { createWsBridge } from "./ws-bridge.js";
import { createSession, updateSession } from "./review-manager.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Resolve the path to the pre-built UI dist directory.
 *
 * Two modes:
 * - Published: ui-dist/ is a sibling of dist/ in the package root
 * - Development: walk up to workspace root → packages/ui/dist/
 */
function resolveUiDist(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // Published mode: dist/ contains this file, ui-dist/ is a sibling
  const publishedUiDist = path.resolve(thisDir, "..", "ui-dist");
  if (fs.existsSync(path.join(publishedUiDist, "index.html"))) {
    return publishedUiDist;
  }

  // Development mode: thisDir is packages/core/src — go up 3 levels to workspace root
  const workspaceRoot = path.resolve(thisDir, "..", "..", "..");
  const devUiDist = path.join(workspaceRoot, "packages", "ui", "dist");
  if (fs.existsSync(path.join(devUiDist, "index.html"))) {
    return devUiDist;
  }

  throw new Error(
    "Could not find built UI. Run 'pnpm -F @diffprism/ui build' first.",
  );
}

/**
 * Resolve the path to the UI source directory (packages/ui).
 * Used in dev mode to run Vite's dev server with HMR.
 */
function resolveUiRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const workspaceRoot = path.resolve(thisDir, "..", "..", "..");
  const uiRoot = path.join(workspaceRoot, "packages", "ui");

  if (fs.existsSync(path.join(uiRoot, "index.html"))) {
    return uiRoot;
  }

  throw new Error(
    "Could not find UI source directory. Dev mode requires the diffprism workspace.",
  );
}

/**
 * Start a Vite dev server for the UI with HMR support.
 * Dynamically imports vite to avoid requiring it as a hard dependency.
 */
async function startViteDevServer(
  uiRoot: string,
  port: number,
  silent: boolean,
): Promise<{ close: () => Promise<void> }> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: uiRoot,
    server: { port, strictPort: true, open: false },
    logLevel: silent ? "silent" : "warn",
  });
  await vite.listen();
  return vite;
}

/**
 * Create a static file server for the pre-built UI with SPA fallback.
 */
function createStaticServer(
  distPath: string,
  port: number,
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] ?? "/";
    let filePath = path.join(distPath, urlPath === "/" ? "index.html" : urlPath);

    // If the file doesn't exist, serve index.html (SPA fallback)
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distPath, "index.html");
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}

export async function startReview(
  options: ReviewOptions,
): Promise<ReviewResult> {
  const { diffRef, title, description, reasoning, cwd, silent, dev } = options;

  // 1. Get the diff
  const { diffSet, rawDiff } = getDiff(diffRef, { cwd });
  const currentBranch = getCurrentBranch({ cwd });

  // Handle empty diff
  if (diffSet.files.length === 0) {
    if (!silent) {
      console.log("No changes to review.");
    }
    return {
      decision: "approved",
      comments: [],
      summary: "No changes to review.",
    };
  }

  // 2. Analyze
  const briefing = analyze(diffSet);

  // 3. Create session
  const session = createSession(options);
  updateSession(session.id, { status: "in_progress" });

  // 4. Get ports
  const [wsPort, httpPort] = await Promise.all([
    getPort(),
    getPort(),
  ]);

  // 5. Start WebSocket bridge
  const bridge = createWsBridge(wsPort);

  // 6. Start UI server (dev mode uses Vite dev server with HMR, otherwise static files)
  let httpServer: http.Server | null = null;
  let viteServer: { close: () => Promise<void> } | null = null;

  try {
    if (dev) {
      const uiRoot = resolveUiRoot();
      viteServer = await startViteDevServer(uiRoot, httpPort, !!silent);
    } else {
      const uiDist = resolveUiDist();
      httpServer = await createStaticServer(uiDist, httpPort);
    }

    // 7. Build the URL and open browser
    const url = `http://localhost:${httpPort}?wsPort=${wsPort}&reviewId=${session.id}`;

    if (!silent) {
      console.log(`\nDiffPrism Review: ${title ?? briefing.summary}`);
      console.log(`Opening browser at ${url}\n`);
    }

    await open(url);

    // 8. Send init payload
    const initPayload: ReviewInitPayload = {
      reviewId: session.id,
      diffSet,
      rawDiff,
      briefing,
      metadata: { title, description, reasoning, currentBranch },
    };

    bridge.sendInit(initPayload);

    // 9. Wait for result
    const result = await bridge.waitForResult();

    // 10. Update session
    updateSession(session.id, { status: "completed", result });

    return result;
  } finally {
    // 11. Cleanup
    bridge.close();
    if (viteServer) {
      await viteServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  }
}
