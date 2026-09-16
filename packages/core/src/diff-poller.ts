import { getDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type { DiffSet, DiffUpdatePayload, ReviewInitPayload, ReviewMetadata } from "./types.js";
import { hashDiff, detectChangedFiles } from "./diff-utils.js";

export interface PollSchedule {
  /** Consecutive polls that found nothing new. Resets to 0 on a change. */
  quietPolls: number;
}

export interface DiffPollerOptions {
  diffRef: string;
  cwd: string;
  /**
   * How long to wait before each poll. A number is a fixed interval. A
   * function is asked before every poll, so a caller can slow a poller down
   * while nobody is watching and let a quiet repo back off.
   */
  pollInterval: number | ((schedule: PollSchedule) => number);
  onDiffChanged: (payload: DiffUpdatePayload) => void;
  onError?: (error: Error) => void;
  silent?: boolean;
}

export interface DiffPoller {
  start: () => void;
  stop: () => void;
  setDiffRef: (newRef: string) => void;
  refresh: () => void;
  /**
   * Poll now and restart the schedule. For a poller that has backed off to a
   * long interval and suddenly matters — someone just opened the session.
   */
  wake: () => void;
}

export function createDiffPoller(options: DiffPollerOptions): DiffPoller {
  let { diffRef } = options;
  const { cwd, pollInterval, onDiffChanged, onError, silent } = options;

  let lastDiffHash: string | null = null;
  let lastDiffSet: DiffSet | null = null;
  let refreshRequested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let quietPolls = 0;

  function nextDelay(): number {
    return typeof pollInterval === "number" ? pollInterval : pollInterval({ quietPolls });
  }

  // A timeout rescheduled after each poll rather than a fixed setInterval, so
  // the interval can change between polls.
  function schedule(): void {
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      poll();
      schedule();
    }, nextDelay());
  }

  function poll(): void {
    if (!running) return;

    try {
      const { diffSet: newDiffSet, rawDiff: newRawDiff } = getDiff(diffRef, { cwd });
      const newHash = hashDiff(newRawDiff);

      if (newHash !== lastDiffHash || refreshRequested) {
        refreshRequested = false;
        quietPolls = 0;

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
      } else {
        quietPolls++;
      }
    } catch (err) {
      // A failing repo backs off like a quiet one rather than retrying at full speed.
      quietPolls++;
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

      schedule();
    },

    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
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

    wake() {
      if (!running) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      poll();
      schedule();
    },
  };
}
