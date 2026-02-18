import { createServer, type ViteDevServer } from "vite";
import getPort from "get-port";
import open from "open";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type { ReviewResult, ReviewOptions, ReviewInitPayload } from "./types.js";
import { createWsBridge } from "./ws-bridge.js";
import { createSession, updateSession } from "./review-manager.js";

/**
 * Resolve the path to the UI package root.
 * Walk up from this file's location to the workspace root, then into packages/ui.
 */
function resolveUiRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const coreDir = path.dirname(thisFile);
  // coreDir is packages/core/src — go up 3 levels to workspace root
  const workspaceRoot = path.resolve(coreDir, "..", "..", "..");
  return path.join(workspaceRoot, "packages", "ui");
}

export async function startReview(
  options: ReviewOptions,
): Promise<ReviewResult> {
  const { diffRef, title, description, reasoning, cwd, silent } = options;

  // 1. Get the diff
  const { diffSet, rawDiff } = getDiff(diffRef, { cwd });

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
  const [wsPort, vitePort] = await Promise.all([
    getPort(),
    getPort(),
  ]);

  // 5. Start WebSocket bridge
  const bridge = createWsBridge(wsPort);

  // 6. Start Vite dev server
  const uiRoot = resolveUiRoot();
  let vite: ViteDevServer | null = null;

  try {
    vite = await createServer({
      root: uiRoot,
      server: {
        port: vitePort,
        strictPort: true,
        open: false,
      },
      logLevel: silent ? "silent" : "warn",
    });

    await vite.listen();

    // 7. Build the URL and open browser
    const url = `http://localhost:${vitePort}?wsPort=${wsPort}&reviewId=${session.id}`;

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
      metadata: { title, description, reasoning },
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
    if (vite) {
      await vite.close();
    }
  }
}
