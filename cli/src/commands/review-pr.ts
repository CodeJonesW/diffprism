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
import { startReview, isServerAlive } from "@diffprism/core";
import type { ReviewResult, ReviewInitPayload } from "@diffprism/core";

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
    const { payload, diffSet, briefing, metadata } = normalizePr(rawDiff, prMetadata, {
      title: flags.title,
      reasoning: flags.reasoning,
    });

    console.log(
      `${diffSet.files.length} files, +${diffSet.files.reduce((s, f) => s + f.additions, 0)} -${diffSet.files.reduce((s, f) => s + f.deletions, 0)}`,
    );

    // 5. Route to global server or ephemeral review
    let result: ReviewResult;

    const serverInfo = await isServerAlive();
    if (serverInfo) {
      // POST to global server
      const createResponse = await fetch(
        `http://localhost:${serverInfo.httpPort}/api/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payload,
            projectPath: `github:${owner}/${repo}`,
            diffRef: `PR #${number}`,
          }),
        },
      );

      if (!createResponse.ok) {
        throw new Error(`Global server returned ${createResponse.status}`);
      }

      const { sessionId } = (await createResponse.json()) as { sessionId: string };
      console.log(`Review session created: ${sessionId}`);
      console.log("Waiting for review submission...");

      // Poll for result
      result = await pollForResult(serverInfo.httpPort, sessionId);
    } else {
      // Ephemeral in-process review with pre-computed payload
      result = await startReview({
        diffRef: `PR #${number}`,
        title: metadata.title,
        description: metadata.description,
        reasoning: metadata.reasoning,
        cwd: process.cwd(),
        dev: flags.dev,
        injectedPayload: payload,
      });
    }

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

async function pollForResult(httpPort: number, sessionId: string): Promise<ReviewResult> {
  const pollIntervalMs = 2000;
  const maxWaitMs = 600 * 1000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const response = await fetch(
      `http://localhost:${httpPort}/api/reviews/${sessionId}/result`,
    );

    if (response.ok) {
      const data = (await response.json()) as {
        result: ReviewResult | null;
        status: string;
      };
      if (data.result) {
        return data.result;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Review timed out waiting for submission.");
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
