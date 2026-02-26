import { getDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type { DiffSet, DiffUpdatePayload, ReviewInitPayload, ReviewMetadata } from "./types.js";
import { hashDiff, detectChangedFiles } from "./diff-utils.js";

export interface DiffPollerOptions {
  diffRef: string;
  cwd: string;
  pollInterval: number;
  onDiffChanged: (payload: DiffUpdatePayload) => void;
  onError?: (error: Error) => void;
  silent?: boolean;
}

export interface DiffPoller {
  start: () => void;
  stop: () => void;
  setDiffRef: (newRef: string) => void;
  refresh: () => void;
}

export function createDiffPoller(options: DiffPollerOptions): DiffPoller {
  let { diffRef } = options;
  const { cwd, pollInterval, onDiffChanged, onError, silent } = options;

  let lastDiffHash: string | null = null;
  let lastDiffSet: DiffSet | null = null;
  let refreshRequested = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function poll(): void {
    if (!running) return;

    try {
      const { diffSet: newDiffSet, rawDiff: newRawDiff } = getDiff(diffRef, { cwd });
      const newHash = hashDiff(newRawDiff);

      if (newHash !== lastDiffHash || refreshRequested) {
        refreshRequested = false;

        const newBriefing = analyze(newDiffSet);
        const changedFiles = detectChangedFiles(lastDiffSet, newDiffSet);

        lastDiffHash = newHash;
        lastDiffSet = newDiffSet;

        const updatePayload: DiffUpdatePayload = {
          diffSet: newDiffSet,
          rawDiff: newRawDiff,
          briefing: newBriefing,
          changedFiles,
          timestamp: Date.now(),
        };

        onDiffChanged(updatePayload);
      }
    } catch (err) {
      // getDiff can fail if git state is mid-operation — silently skip by default
      if (onError && err instanceof Error) {
        onError(err);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;

      // Initialize hash from first poll without triggering onDiffChanged
      try {
        const { diffSet: initialDiffSet, rawDiff: initialRawDiff } = getDiff(diffRef, { cwd });
        lastDiffHash = hashDiff(initialRawDiff);
        lastDiffSet = initialDiffSet;
      } catch {
        // Will catch on next poll
      }

      interval = setInterval(poll, pollInterval);
    },

    stop() {
      running = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },

    setDiffRef(newRef: string) {
      diffRef = newRef;
      // Reset hash to force next poll to detect a change
      lastDiffHash = null;
      lastDiffSet = null;
    },

    refresh() {
      refreshRequested = true;
    },
  };
}
