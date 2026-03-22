import { ensureServer, submitReviewToServer } from "@diffprism/core";
import { isPrRef, parsePrRef } from "@diffprism/github";

interface ReviewFlags {
  staged?: boolean;
  unstaged?: boolean;
  title?: string;
  reasoning?: string;
  dev?: boolean;
  postToGithub?: boolean;
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
    if (isPrRef(diffRef)) {
      await reviewPrFlow(diffRef, flags);
    } else {
      await reviewLocalFlow(diffRef, flags);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

async function reviewLocalFlow(
  diffRef: string,
  flags: ReviewFlags,
): Promise<void> {
  const serverInfo = await ensureServer({ dev: flags.dev });

  console.log("Opening review in browser...");

  const { result } = await submitReviewToServer(serverInfo, diffRef, {
    title: flags.title,
    cwd: process.cwd(),
    diffRef,
  });

  // Print structured result to stdout
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

async function reviewPrFlow(
  pr: string,
  flags: ReviewFlags,
): Promise<void> {
  const { owner, repo, number } = parsePrRef(pr);
  console.log(`Fetching PR #${number} from ${owner}/${repo}...`);

  // Auto-start server if needed
  const serverInfo = await ensureServer({ dev: flags.dev });

  // Use /api/pr/open — handles GitHub fetch + local repo auto-detection
  const response = await fetch(
    `http://localhost:${serverInfo.httpPort}/api/pr/open`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prUrl: pr }),
    },
  );

  const data = await response.json() as {
    sessionId?: string;
    fileCount?: number;
    localRepoPath?: string | null;
    pr?: { title: string; author: string; url: string; baseBranch: string; headBranch: string };
    error?: string;
  };

  if (!response.ok || !data.sessionId) {
    console.error(`Error: ${data.error ?? "Failed to open PR"}`);
    process.exit(1);
  }

  console.log(`${data.pr?.title ?? `PR #${number}`}`);
  console.log(`${data.fileCount} file${data.fileCount !== 1 ? "s" : ""} changed`);

  if (data.localRepoPath) {
    console.log(`Local repo: ${data.localRepoPath}`);
  } else {
    console.log("No local clone detected — file context unavailable");
  }

  console.log(`\nReview open in browser. Use Claude Code to ask questions about this PR.`);
  console.log(`MCP tools available: get_pr_context, get_file_diff, get_file_context, add_review_comment`);
}
