import { startReview } from "@diffprism/core";

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
    // Default to all changes (staged + unstaged) if no ref specified
    diffRef = "all";
  }

  try {
    const result = await startReview({
      diffRef,
      title: flags.title,
      cwd: process.cwd(),
      dev: flags.dev,
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
