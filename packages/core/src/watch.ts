import http from "node:http";
import getPort from "get-port";
import open from "open";

import { getDiff, getCurrentBranch } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type {
  WatchOptions,
  WatchHandle,
  ReviewInitPayload,
  DiffUpdatePayload,
  ContextUpdatePayload,
  ReviewMetadata,
} from "./types.js";
import { createWatchBridge } from "./watch-bridge.js";
import { writeWatchFile, removeWatchFile, writeReviewResult } from "./watch-file.js";
import {
  resolveUiDist,
  resolveUiRoot,
  startViteDevServer,
  createStaticServer,
} from "./ui-server.js";
import { hashDiff, detectChangedFiles } from "./diff-utils.js";

export async function startWatch(options: WatchOptions): Promise<WatchHandle> {
  const {
    diffRef,
    title,
    description,
    reasoning,
    cwd,
    silent,
    dev,
    pollInterval = 1000,
  } = options;

  // 1. Initial getDiff + analyze
  const { diffSet: initialDiffSet, rawDiff: initialRawDiff } = getDiff(diffRef, { cwd });
  const currentBranch = getCurrentBranch({ cwd });
  const initialBriefing = analyze(initialDiffSet);

  let lastDiffHash = hashDiff(initialRawDiff);
  let lastDiffSet = initialDiffSet;

  // Track mutable metadata
  const metadata: ReviewMetadata = {
    title,
    description,
    reasoning,
    currentBranch,
  };

  // 2. Allocate ports
  const [bridgePort, uiPort] = await Promise.all([
    getPort(),
    getPort(),
  ]);

  // 3. Create watch bridge with refresh flag
  let refreshRequested = false;

  const bridge = await createWatchBridge(bridgePort, {
    onRefreshRequest: () => {
      refreshRequested = true;
    },
    onContextUpdate: (payload: ContextUpdatePayload) => {
      if (payload.reasoning !== undefined) metadata.reasoning = payload.reasoning;
      if (payload.title !== undefined) metadata.title = payload.title;
      if (payload.description !== undefined) metadata.description = payload.description;
    },
  });

  // 4. Start UI server
  let httpServer: http.Server | null = null;
  let viteServer: { close: () => Promise<void> } | null = null;

  if (dev) {
    const uiRoot = resolveUiRoot();
    viteServer = await startViteDevServer(uiRoot, uiPort, !!silent);
  } else {
    const uiDist = resolveUiDist();
    httpServer = await createStaticServer(uiDist, uiPort);
  }

  // 5. Write discovery file
  writeWatchFile(cwd, {
    wsPort: bridgePort,
    uiPort,
    pid: process.pid,
    cwd: cwd ?? process.cwd(),
    diffRef,
    startedAt: Date.now(),
  });

  // 6. Open browser
  const reviewId = "watch-session";
  const url = `http://localhost:${uiPort}?wsPort=${bridgePort}&reviewId=${reviewId}`;

  if (!silent) {
    console.log(`\nDiffPrism Watch: ${title ?? `watching ${diffRef}`}`);
    console.log(`Browser: ${url}`);
    console.log(`API: http://localhost:${bridgePort}`);
    console.log(`Polling every ${pollInterval}ms\n`);
  }

  await open(url);

  // 7. Send initial review:init with watchMode flag
  const initPayload: ReviewInitPayload = {
    reviewId,
    diffSet: initialDiffSet,
    rawDiff: initialRawDiff,
    briefing: initialBriefing,
    metadata,
    watchMode: true,
  };

  bridge.sendInit(initPayload);

  // 8. Handle submit — log, write result file, and keep watching
  bridge.onSubmit((result) => {
    if (!silent) {
      console.log(`\nReview submitted: ${result.decision}`);
      if (result.comments.length > 0) {
        console.log(`  ${result.comments.length} comment(s)`);
      }
      console.log("Continuing to watch...\n");
    }
    writeReviewResult(cwd, result);
  });

  // 9. Start poll loop
  let pollRunning = true;
  const pollLoop = setInterval(() => {
    if (!pollRunning) return;

    try {
      const { diffSet: newDiffSet, rawDiff: newRawDiff } = getDiff(diffRef, { cwd });
      const newHash = hashDiff(newRawDiff);

      if (newHash !== lastDiffHash || refreshRequested) {
        refreshRequested = false;

        const newBriefing = analyze(newDiffSet);
        const changedFiles = detectChangedFiles(lastDiffSet, newDiffSet);

        lastDiffHash = newHash;
        lastDiffSet = newDiffSet;

        // Update stored init payload for reconnects (don't send to connected client)
        bridge.storeInitPayload({
          reviewId,
          diffSet: newDiffSet,
          rawDiff: newRawDiff,
          briefing: newBriefing,
          metadata,
          watchMode: true,
        });

        const updatePayload: DiffUpdatePayload = {
          diffSet: newDiffSet,
          rawDiff: newRawDiff,
          briefing: newBriefing,
          changedFiles,
          timestamp: Date.now(),
        };

        bridge.sendDiffUpdate(updatePayload);

        if (!silent && changedFiles.length > 0) {
          console.log(
            `[${new Date().toLocaleTimeString()}] Diff updated: ${changedFiles.length} file(s) changed`,
          );
        }
      }
    } catch {
      // getDiff can fail if git state is mid-operation — silently skip
    }
  }, pollInterval);

  // 10. Build the stop function
  async function stop(): Promise<void> {
    pollRunning = false;
    clearInterval(pollLoop);
    await bridge.close();
    if (viteServer) {
      await viteServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
    removeWatchFile(cwd);
  }

  function updateContext(payload: ContextUpdatePayload): void {
    if (payload.reasoning !== undefined) metadata.reasoning = payload.reasoning;
    if (payload.title !== undefined) metadata.title = payload.title;
    if (payload.description !== undefined) metadata.description = payload.description;
    bridge.sendContextUpdate(payload);
  }

  return { stop, updateContext };
}
