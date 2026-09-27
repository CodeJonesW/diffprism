import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PrCheckoutRequest {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  baseSha: string;
  /** Where DiffPrism keeps its own copies of repositories. */
  root: string;
  /** The repository to fetch from, e.g. https://github.com/owner/repo.git. */
  remoteUrl: string;
  /** Sent as the fetch's credentials; never written to disk or put in a command line. */
  token: string;
}

/**
 * Check a pull request's head out where a review can read it, without
 * touching any clone of the reviewer's (#240).
 *
 * The head and base commits are fetched into a bare repository of DiffPrism's
 * own, one per GitHub repo, and the head is checked out, detached, in a
 * worktree of its own, one per PR. Opening the PR again moves that worktree to
 * the PR's current head. Returns the worktree's path.
 *
 * Fetching by commit rather than by branch means it's exactly the commit the
 * review shows, and a fork's PR works the same as any other.
 */
export function checkoutPullRequest(request: PrCheckoutRequest): Promise<string> {
  const repoDir = path.join(request.root, request.owner, `${request.repo}.git`);
  // Two PRs of one repo opened together would fetch into the same repository
  // at once, and git's locks would fail one of them.
  const previous = inFlight.get(repoDir) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => checkout(request, repoDir));
  inFlight.set(repoDir, next);
  return next.finally(() => {
    if (inFlight.get(repoDir) === next) inFlight.delete(repoDir);
  });
}

const inFlight = new Map<string, Promise<string>>();

async function checkout(request: PrCheckoutRequest, repoDir: string): Promise<string> {
  const worktree = path.join(request.root, request.owner, request.repo, `pr-${request.number}`);

  if (!fs.existsSync(repoDir)) {
    fs.mkdirSync(repoDir, { recursive: true });
    await git(["init", "--bare", "--quiet", repoDir]);
  }

  // The token rides in environment config, so it appears in neither the
  // process list nor the repository's config.
  const basic = Buffer.from(`x-access-token:${request.token}`).toString("base64");
  await git(["-C", repoDir, "fetch", "--quiet", "--no-tags", "--depth=1", request.remoteUrl, request.headSha, request.baseSha], {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  });

  if (fs.existsSync(worktree)) {
    await git(["-C", worktree, "checkout", "--quiet", "--detach", "--force", request.headSha]);
  } else {
    // A worktree whose folder was deleted is still registered, and would
    // refuse the path.
    await git(["-C", repoDir, "worktree", "prune"]);
    await git(["-C", repoDir, "worktree", "add", "--quiet", "--detach", worktree, request.headSha]);
  }
  return worktree;
}

async function git(args: string[], env: Record<string, string> = {}): Promise<void> {
  try {
    await execFileAsync("git", args, { env: { ...process.env, ...env }, maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    const command = args[0] === "-C" ? args[2] : args[0];
    throw new Error(`git ${command} failed: ${stderr || (err as Error).message}`);
  }
}
