import http from "node:http";
import getPort from "get-port";
import open from "open";

import { getDiff, getCurrentBranch, listBranches, listCommits } from "@diffprism/git";
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
import { createDiffPoller } from "./diff-poller.js";
import { writeWatchFile, removeWatchFile, writeReviewResult } from "./watch-file.js";
import {
  resolveUiDist,
  resolveUiRoot,
  startViteDevServer,
  createStaticServer,
} from "./ui-server.js";

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

  const reviewId = "watch-session";

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
      reviewId,
      diffSet: newDiffSet,
      rawDiff: newRawDiff,
      briefing: newBriefing,
      metadata,
      watchMode: true,
    });

    poller.setDiffRef(newRef);
  }

  // 3. Create watch bridge with ref selection support
  const bridge = await createWatchBridge(bridgePort, {
    onRefreshRequest: () => {
      poller.refresh();
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
  const url = `http://localhost:${uiPort}?wsPort=${bridgePort}&httpPort=${bridgePort}&reviewId=${reviewId}`;

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

  // 9. Start diff poller
  const poller = createDiffPoller({
    diffRef,
    cwd: cwd ?? process.cwd(),
    pollInterval,
    onDiffChanged: (updatePayload: DiffUpdatePayload) => {
      // Update stored init payload for reconnects
      bridge.storeInitPayload({
        reviewId,
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

  // 10. Build the stop function
  async function stop(): Promise<void> {
    poller.stop();
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
