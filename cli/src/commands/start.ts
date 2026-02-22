import { setup } from "./setup.js";
import { startWatch } from "@diffprism/core";

interface StartFlags {
  staged?: boolean;
  unstaged?: boolean;
  title?: string;
  dev?: boolean;
  interval?: string;
  global?: boolean;
  force?: boolean;
}

export async function start(
  ref: string | undefined,
  flags: StartFlags,
): Promise<void> {
  // Step 1: Run setup quietly
  const outcome = await setup({
    global: flags.global,
    force: flags.force,
    quiet: true,
  });

  const hasChanges = outcome.created.length > 0 || outcome.updated.length > 0;

  if (hasChanges) {
    console.log("✓ DiffPrism configured for Claude Code.");
  }

  // Step 2: Determine diff ref
  let diffRef: string;

  if (flags.staged) {
    diffRef = "staged";
  } else if (flags.unstaged) {
    diffRef = "unstaged";
  } else if (ref) {
    diffRef = ref;
  } else {
    diffRef = "working-copy";
  }

  const pollInterval = flags.interval ? parseInt(flags.interval, 10) : 1000;

  // Step 3: Start watch (startWatch prints its own URL output)
  try {
    const handle = await startWatch({
      diffRef,
      title: flags.title,
      cwd: process.cwd(),
      dev: flags.dev,
      pollInterval,
    });

    console.log("Use /review in Claude Code to send changes for review.");
    if (hasChanges) {
      console.log(
        "If this is your first time, restart Claude Code first to load the MCP server.",
      );
    }

    // Graceful shutdown on SIGINT/SIGTERM
    const shutdown = async () => {
      console.log("\nStopping DiffPrism...");
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
