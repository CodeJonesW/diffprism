import readline from "node:readline";
import {
  resolveGitHubToken,
  parsePrRef,
  createGitHubClient,
  fetchPullRequest,
  fetchPullRequestDiff,
  normalizePr,
  submitGitHubReview,
} from "@diffprism/github";
import { ensureServer, submitReviewToServer } from "@diffprism/core";

interface ReviewPrFlags {
  title?: string;
  reasoning?: string;
  dev?: boolean;
  postToGithub?: boolean;
}

export async function reviewPr(
  pr: string,
  flags: ReviewPrFlags,
): Promise<void> {
  try {
    // 1. Resolve token
    const token = resolveGitHubToken();

    // 2. Parse PR ref
    const { owner, repo, number } = parsePrRef(pr);
    console.log(`Fetching PR #${number} from ${owner}/${repo}...`);

    // 3. Fetch PR data
    const client = createGitHubClient(token);
    const [prMetadata, rawDiff] = await Promise.all([
      fetchPullRequest(client, owner, repo, number),
      fetchPullRequestDiff(client, owner, repo, number),
    ]);

    if (!rawDiff.trim()) {
      console.log("PR has no changes to review.");
      return;
    }

    // 4. Normalize to DiffPrism types
    const { payload, diffSet } = normalizePr(rawDiff, prMetadata, {
      title: flags.title,
      reasoning: flags.reasoning,
    });

    console.log(
      `${diffSet.files.length} files, +${diffSet.files.reduce((s, f) => s + f.additions, 0)} -${diffSet.files.reduce((s, f) => s + f.deletions, 0)}`,
    );

    // 5. Route through global server (auto-start if needed)
    const serverInfo = await ensureServer({ dev: flags.dev });
    const { result } = await submitReviewToServer(serverInfo, `PR #${number}`, {
      injectedPayload: payload,
      projectPath: `github:${owner}/${repo}`,
      diffRef: `PR #${number}`,
    });

    console.log(JSON.stringify(result, null, 2));

    // 6. Offer to post review back to GitHub
    if (flags.postToGithub || (result.decision !== "dismissed" && await promptPostToGithub())) {
      console.log("Posting review to GitHub...");
      const posted = await submitGitHubReview(client, owner, repo, number, result);
      if (posted) {
        console.log(`Review posted: ${prMetadata.url}#pullrequestreview-${posted.reviewId}`);
      }
    }

    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

async function promptPostToGithub(): Promise<boolean> {
  // Non-interactive mode (piped stdin)
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Post this review to GitHub? (y/N) ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}
