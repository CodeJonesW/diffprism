import { ensureServer, submitReviewToServer } from "@diffprism/core";

interface ReviewFlags {
  staged?: boolean;
  unstaged?: boolean;
  title?: string;
  dev?: boolean;
}

export async function review(
  ref: string | undefined,
  flags: ReviewFlags,
): Promise<void> {
  let diffRef: string;

  if (flags.staged) {
    diffRef = "staged";
  } else if (flags.unstaged) {
    diffRef = "unstaged";
  } else if (ref) {
    diffRef = ref;
  } else {
    // Default to working-copy mode: staged/unstaged shown as separate groups
    diffRef = "working-copy";
  }

  try {
    const serverInfo = await ensureServer({ dev: flags.dev });
    const { result } = await submitReviewToServer(serverInfo, diffRef, {
      title: flags.title,
      cwd: process.cwd(),
      diffRef,
    });

    // Print structured result to stdout
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
