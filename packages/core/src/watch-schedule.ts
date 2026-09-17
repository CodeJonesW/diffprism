/**
 * How often a session's watcher runs `git diff`.
 *
 * Every session with a diff ref shells out to git on a timer. Watchers used to
 * run every 2 seconds whether or not anyone was looking — N open sessions
 * meant N git subprocesses every 2 seconds, forever — which on a large repo is
 * real CPU and battery. They can't simply stop when unviewed, because a
 * session that changes while nobody is looking still has to raise its
 * new-changes signal in the sidebar.
 *
 * So: full speed while viewed, slow while not, and slower still the longer a
 * repo stays quiet. The paths that most need an instant update don't depend on
 * polling at all — a hook firing or an agent opening a review updates the
 * session directly — and a session wakes the moment someone opens it.
 */

export interface WatchScheduleOptions {
  /** Interval while a client is viewing the session. */
  viewedMs: number;
  /** First interval once nobody is viewing. */
  unviewedMs: number;
  /** Ceiling for the unviewed back-off. */
  unviewedMaxMs: number;
}

export const DEFAULT_WATCH_SCHEDULE: WatchScheduleOptions = {
  viewedMs: 2_000,
  unviewedMs: 30_000,
  unviewedMaxMs: 5 * 60_000,
};

export function watcherPollDelay(
  state: { viewed: boolean; quietPolls: number },
  options: WatchScheduleOptions = DEFAULT_WATCH_SCHEDULE,
): number {
  if (state.viewed) {
    return options.viewedMs;
  }
  // Double for every quiet poll: 30s, 1m, 2m, 4m, then the ceiling. Capping
  // the exponent keeps the arithmetic finite for a repo quiet for days.
  const backedOff = options.unviewedMs * 2 ** Math.min(state.quietPolls, 20);
  return Math.min(backedOff, options.unviewedMaxMs);
}
