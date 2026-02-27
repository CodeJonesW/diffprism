import { ensureServer, submitReviewToServer } from "@diffprism/core";

interface WatchFlags {
  staged?: boolean;
  unstaged?: boolean;
  title?: string;
  dev?: boolean;
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
    diffRef = "working-copy";
  }

  try {
    // Ensure server is running (auto-starts daemon if needed)
    const serverInfo = await ensureServer({ dev: flags.dev });

    console.log(
      `DiffPrism server at http://localhost:${serverInfo.httpPort}`,
    );
    console.log("Submitting review session...");

    // Submit review — the server handles watching via DiffPoller
    const { result } = await submitReviewToServer(serverInfo, diffRef, {
      title: flags.title,
      cwd: process.cwd(),
      diffRef,
    });

    // Print result when user submits
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
