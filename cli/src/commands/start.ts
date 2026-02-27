import { setup } from "./setup.js";
import { ensureServer, submitReviewToServer } from "@diffprism/core";

interface StartFlags {
  staged?: boolean;
  unstaged?: boolean;
  title?: string;
  dev?: boolean;
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
    console.log("DiffPrism configured for Claude Code.");
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

  // Step 3: Ensure server is running and submit review
  try {
    const serverInfo = await ensureServer({ dev: flags.dev });

    console.log(
      `DiffPrism server at http://localhost:${serverInfo.httpPort}`,
    );

    if (hasChanges) {
      console.log(
        "If this is your first time, restart Claude Code first to load the MCP server.",
      );
    }

    const { result } = await submitReviewToServer(serverInfo, diffRef, {
      title: flags.title,
      cwd: process.cwd(),
      diffRef,
    });

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
