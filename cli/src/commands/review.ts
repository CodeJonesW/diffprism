import { ensureServer, submitReviewToServer, ReviewerAskedError, DEFAULT_DIFF_REF, recordError, REPORT_HINT } from "@diffprism/core";
import type { ReviewResult } from "@diffprism/core";
import { printQuestions } from "./hook.js";
import { isPrRef, parsePrRef } from "@diffprism/github";

interface ReviewFlags {
  staged?: boolean;
  unstaged?: boolean;
  title?: string;
  reasoning?: string;
  dev?: boolean;
  postToGithub?: boolean;
  /** False with --no-agent: open a PR review without starting Claude Code to answer comments. */
  agent?: boolean;
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
    diffRef = DEFAULT_DIFF_REF;
  }

  try {
    if (isPrRef(diffRef)) {
      await reviewPrFlow(diffRef, flags);
    } else {
      await reviewLocalFlow(diffRef, flags);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError("review", err);
    console.error(`Error: ${message}`);
    console.error(REPORT_HINT);
    process.exit(1);
  }
}

async function reviewLocalFlow(
  diffRef: string,
  flags: ReviewFlags,
): Promise<void> {
  const serverInfo = await ensureServer({ dev: flags.dev });

  // Progress goes to stderr so stdout carries nothing but the ReviewResult,
  // and a caller can pipe it straight into a JSON parser.
  console.error("Opening review in browser...");

  let result: ReviewResult | null;
  try {
    ({ result } = await submitReviewToServer(serverInfo, diffRef, {
      title: flags.title,
      reasoning: flags.reasoning,
      cwd: process.cwd(),
      diffRef,
    }));
  } catch (err) {
    if (err instanceof ReviewerAskedError) {
      printQuestions(err.sessionId, err.threads);
      console.error(
        "The reviewer asked something before deciding. Answer each question with the command under it, then run diffprism review again straight away to keep waiting — the review stays open, and the reviewer may ask more. Don't stop to ask them in the terminal.",
      );
      process.exit(1);
    }
    throw err;
  }

  // Print structured result to stdout
  console.log(JSON.stringify(result, null, 2));

  // The exit code carries the verdict. Callers that gate on a review — a
  // pre-commit hook, CI — need to tell approval from rejection without
  // parsing anything, and anything that is not an approval is a refusal.
  if (!result) {
    console.error("No review result was returned.");
    process.exit(1);
  }
  const approved =
    result.decision === "approved" || result.decision === "approved_with_comments";
  process.exit(approved ? 0 : 1);
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
      // cwd is where to look for a local clone to read the PR from (#197).
      body: JSON.stringify({
        prUrl: pr,
        cwd: process.cwd(),
        title: flags.title,
        reasoning: flags.reasoning,
        agent: flags.agent !== false,
      }),
    },
  );

  const data = await response.json() as {
    sessionId?: string;
    fileCount?: number;
    localRepoPath?: string | null;
    pr?: { title: string; author: string; url: string; baseBranch: string; headBranch: string };
    /** The agent answering this review's comments, which the server runs (#224). */
    agent?: { conversationId: string; cwd: string } | null;
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

  if (data.agent) {
    const { conversationId, cwd } = data.agent;
    // Claude Code keeps a conversation with the folder it ran in, so resuming
    // has to happen from there.
    const cd = cwd === process.cwd() ? "" : `cd ${/\s/.test(cwd) ? `"${cwd}"` : cwd} && `;
    console.log(`\nReview open in browser. Claude Code is answering — comment on any line and it replies there.`);
    console.log(`Once it has answered, continue the conversation in your terminal: ${cd}claude --resume ${conversationId}`);
    return;
  }

  if (flags.agent === false) {
    // No list of tool names here: one printed by hand went stale when tools
    // were renamed (#198). The /review skill is where an agent learns them.
    console.log(`\nReview open in browser. Ask Claude Code about this PR — the /review skill shows it how.`);
    return;
  }

  // The server runs the agent, so it's the server that found no Claude Code —
  // or it's a server from before #224, which never starts one.
  console.log(`\nReview open in browser. No agent started to answer your comments — is Claude Code installed?`);
  console.log(`In a Claude Code session, ask: Answer my DiffPrism comments on ${data.sessionId}`);
}

