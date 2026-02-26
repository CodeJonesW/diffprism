import http from "node:http";
import getPort from "get-port";
import open from "open";

import { getDiff, getCurrentBranch, listBranches, listCommits } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type {
  ReviewResult,
  ReviewOptions,
  ReviewInitPayload,
  ReviewMetadata,
  ContextUpdatePayload,
  DiffUpdatePayload,
} from "./types.js";
import { createWatchBridge } from "./watch-bridge.js";
import { createDiffPoller } from "./diff-poller.js";
import type { DiffPoller } from "./diff-poller.js";
import { createSession, updateSession } from "./review-manager.js";
import { writeWatchFile, removeWatchFile } from "./watch-file.js";
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

  // Track mutable metadata
  const metadata: ReviewMetadata = {
    title,
    description,
    reasoning,
    currentBranch,
  };

  // Poller reference — set after bridge creation, used in callbacks
  let poller: DiffPoller | null = null;

  // 4. Get ports
  const [bridgePort, httpPort] = await Promise.all([
    getPort(),
    getPort(),
  ]);

  // Shared handler for ref changes (used by both WS and HTTP paths)
  function handleDiffRefChange(newRef: string): void {
    const { diffSet: newDiffSet, rawDiff: newRawDiff } = getDiff(newRef, { cwd });
    const newBriefing = analyze(newDiffSet);

    bridge.sendDiffUpdate({
      diffSet: newDiffSet,
      rawDiff: newRawDiff,
      briefing: newBriefing,
      changedFiles: newDiffSet.files.map((f) => f.path),
      timestamp: Date.now(),
    });

    bridge.storeInitPayload({
      reviewId: session.id,
      diffSet: newDiffSet,
      rawDiff: newRawDiff,
      briefing: newBriefing,
      metadata,
      watchMode: true,
    });

    poller?.setDiffRef(newRef);
  }

  // 5. Create WatchBridge (HTTP + WS) with ref selection support
  const bridge = await createWatchBridge(bridgePort, {
    onRefreshRequest: () => {
      poller?.refresh();
    },
    onContextUpdate: (payload: ContextUpdatePayload) => {
      if (payload.reasoning !== undefined) metadata.reasoning = payload.reasoning;
      if (payload.title !== undefined) metadata.title = payload.title;
      if (payload.description !== undefined) metadata.description = payload.description;
    },
    onDiffRefChange: (newRef: string) => {
      try {
        handleDiffRefChange(newRef);
      } catch (err) {
        bridge.sendDiffError({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    onRefsRequest: async () => {
      try {
        const resolvedCwd = cwd ?? process.cwd();
        const branches = listBranches({ cwd: resolvedCwd });
        const commits = listCommits({ cwd: resolvedCwd });
        const branch = getCurrentBranch({ cwd: resolvedCwd });
        return { branches, commits, currentBranch: branch };
      } catch {
        return null;
      }
    },
    onCompareRequest: async (ref: string) => {
      try {
        handleDiffRefChange(ref);
        return true;
      } catch {
        return false;
      }
    },
  });

  // 6. Start UI server
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

    // 7. Write discovery file (allows MCP context updates)
    writeWatchFile(cwd, {
      wsPort: bridgePort,
      uiPort: httpPort,
      pid: process.pid,
      cwd: cwd ?? process.cwd(),
      diffRef,
      startedAt: Date.now(),
    });

    // 8. Build the URL and open browser
    const url = `http://localhost:${httpPort}?wsPort=${bridgePort}&httpPort=${bridgePort}&reviewId=${session.id}`;

    if (!silent) {
      console.log(`\nDiffPrism Review: ${title ?? briefing.summary}`);
      console.log(`Opening browser at ${url}\n`);
    }

    await open(url);

    // 9. Send init payload with watchMode enabled for live updates
    const initPayload: ReviewInitPayload = {
      reviewId: session.id,
      diffSet,
      rawDiff,
      briefing,
      metadata,
      watchMode: true,
    };

    bridge.sendInit(initPayload);

    // 10. Start diff poller for live updates
    poller = createDiffPoller({
      diffRef,
      cwd: cwd ?? process.cwd(),
      pollInterval: 1000,
      onDiffChanged: (updatePayload: DiffUpdatePayload) => {
        // Update stored init payload for reconnects
        bridge.storeInitPayload({
          reviewId: session.id,
          diffSet: updatePayload.diffSet,
          rawDiff: updatePayload.rawDiff,
          briefing: updatePayload.briefing,
          metadata,
          watchMode: true,
        });

        bridge.sendDiffUpdate(updatePayload);

        if (!silent && updatePayload.changedFiles.length > 0) {
          console.log(
            `[${new Date().toLocaleTimeString()}] Diff updated: ${updatePayload.changedFiles.length} file(s) changed`,
          );
        }
      },
    });
    poller.start();

    // 11. Wait for result
    const result = await bridge.waitForResult();

    // 12. Stop poller and update session
    poller.stop();
    updateSession(session.id, { status: "completed", result });

    return result;
  } finally {
    // 13. Cleanup
    poller?.stop();
    await bridge.close();
    removeWatchFile(cwd);
    if (viteServer) {
      await viteServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  }
}
