import http from "node:http";
import getPort from "get-port";
import open from "open";

import { getDiff, getCurrentBranch } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type { ReviewResult, ReviewOptions, ReviewInitPayload } from "./types.js";
import { createWsBridge } from "./ws-bridge.js";
import { createSession, updateSession } from "./review-manager.js";
import {
  resolveUiDist,
  resolveUiRoot,
  startViteDevServer,
  createStaticServer,
} from "./ui-server.js";

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
