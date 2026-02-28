import { ensureServer, submitReviewToServer } from "@diffprism/core";
import type { ReviewInitPayload, DiffSet, ReviewBriefing } from "@diffprism/core";
import { sampleDiff } from "../demo-data/sample-diff.js";

interface DemoFlags {
  dev?: boolean;
}

export async function demo(flags: DemoFlags): Promise<void> {
  try {
    console.log("Starting DiffPrism demo...\n");

    // Dynamic imports — these packages aren't direct CLI dependencies
    const { parseDiff } = await import("@diffprism/git") as { parseDiff: (raw: string, base: string, head: string) => DiffSet };
    const { analyze } = await import("@diffprism/analysis") as { analyze: (diffSet: DiffSet) => ReviewBriefing };

    // 1. Parse embedded diff
    const diffSet = parseDiff(sampleDiff, "main", "feature/add-auth");

    // 2. Analyze
    const briefing = analyze(diffSet);

    console.log(
      `${diffSet.files.length} files, +${diffSet.files.reduce((s: number, f: { additions: number }) => s + f.additions, 0)} -${diffSet.files.reduce((s: number, f: { deletions: number }) => s + f.deletions, 0)}`,
    );

    // 3. Build payload
    const payload: ReviewInitPayload = {
      reviewId: "",
      diffSet,
      rawDiff: sampleDiff,
      briefing,
      metadata: {
        title: "Add user authentication middleware",
        reasoning:
          "Added JWT-based auth middleware to protect API routes. Included token validation, error handling for expired tokens, and unit tests for the middleware.",
        currentBranch: "feature/add-auth",
      },
    };

    // 4. Route through global server (auto-start if needed)
    const serverInfo = await ensureServer({ dev: flags.dev });
    const { result } = await submitReviewToServer(serverInfo, "demo", {
      injectedPayload: payload,
      projectPath: "demo",
      diffRef: "demo",
    });

    console.log(`\nReview submitted: ${result.decision}`);
    if (result.comments.length > 0) {
      console.log(`${result.comments.length} comment(s)`);
    }

    console.log("\nNext steps:");
    console.log("  Run `npx diffprism setup` to configure for Claude Code");
    console.log("  Run `npx diffprism review` in a git repo to review real changes\n");

    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
