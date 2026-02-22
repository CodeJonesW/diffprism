import { startWatch } from "@diffprism/core";

interface WatchFlags {
  staged?: boolean;
  unstaged?: boolean;
  title?: string;
  dev?: boolean;
  interval?: string;
}

export async function watch(
  ref: string | undefined,
  flags: WatchFlags,
): Promise<void> {
  let diffRef: string;

  if (flags.staged) {
    diffRef = "staged";
  } else if (flags.unstaged) {
    diffRef = "unstaged";
  } else if (ref) {
    diffRef = ref;
  } else {
    diffRef = "all";
  }

  const pollInterval = flags.interval ? parseInt(flags.interval, 10) : 1000;

  try {
    const handle = await startWatch({
      diffRef,
      title: flags.title,
      cwd: process.cwd(),
      dev: flags.dev,
      pollInterval,
    });

    // Graceful shutdown on SIGINT/SIGTERM
    const shutdown = async () => {
      console.log("\nStopping watch...");
      await handle.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process alive
    await new Promise(() => {
      // Never resolves — watch runs until interrupted
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
