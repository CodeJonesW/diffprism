import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

/** A GitHub owner or repo name, safe to use as a folder name (#257). */
const PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function checkSegment(kind: string, value: string): void {
  if (!PATH_SEGMENT.test(value) || value === "." || value === "..") {
    throw new Error(`Not a GitHub ${kind} name DiffPrism can check out: ${JSON.stringify(value)}`);
  }
}

async function checkout(request: PrCheckoutRequest, repoDir: string): Promise<string> {
  checkSegment("owner", request.owner);
  checkSegment("repo", request.repo);
  const worktree = path.join(request.root, request.owner, request.repo, `pr-${request.number}`);

  // Made again only when it's plainly not a repository: missing, or a
  // folder an init left partway, without HEAD or objects (#257). Anything
  // else a git command trips on is an error to see, never a reason to delete
  // every PR's fetched objects.
  if (!fs.existsSync(path.join(repoDir, "HEAD")) || !fs.existsSync(path.join(repoDir, "objects"))) {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.mkdirSync(repoDir, { recursive: true });
    await git(["init", "--bare", "--quiet", repoDir]);
  }

  // The token rides in environment config, so it appears in neither the
  // process list nor the repository's config. Each commit goes into a ref
  // of the PR's own: in a shallow repository a commit nothing points at is
  // gc's to prune, and the base would vanish from under a later read (#257).
  const basic = Buffer.from(`x-access-token:${request.token}`).toString("base64");
  const refs = `refs/diffprism/pr-${request.number}`;
  await git(
    ["-C", repoDir, "fetch", "--quiet", "--no-tags", "--depth=1", request.remoteUrl, `+${request.headSha}:${refs}/head`, `+${request.baseSha}:${refs}/base`],
    { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` },
  );

  // A worktree holds a .git file linking it to the repository. Without one
  // the folder isn't a worktree — an add that failed left it — and is made
  // afresh; with one, a checkout that fails says why.
  if (fs.existsSync(path.join(worktree, ".git"))) {
    await git(["-C", worktree, "checkout", "--quiet", "--detach", "--force", request.headSha]);
  } else {
    // A worktree whose folder was deleted is still registered, and would
    // refuse the path, so the registrations are pruned first.
    fs.rmSync(worktree, { recursive: true, force: true });
    await git(["-C", repoDir, "worktree", "prune"]);
    await git(["-C", repoDir, "worktree", "add", "--quiet", "--detach", worktree, request.headSha]);
  }
  // Exactly the PR's head, whatever was left in the folder before (#257).
  await git(["-C", worktree, "clean", "-ffdxq"]);
  return worktree;
}

/**
 * Every git command here runs apart from the reviewer's own git config, their
 * global and system files (#257). The fetch carries their GitHub token, and
 * a URL rewrite, a proxy or a credential helper in their config could send it
 * elsewhere; a checkout would run their smudge filters (Git LFS, say), which
 * fetch on their own, without the token, from wherever the filter says. None
 * of it is needed to read a PR. The repository's own config is DiffPrism's.
 */
const ISOLATED: Record<string, string> = {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

async function git(args: string[], env: Record<string, string> = {}): Promise<void> {
  try {
    await execFileAsync("git", args, { env: { ...process.env, ...ISOLATED, ...env }, maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    const command = args[0] === "-C" ? args[2] : args[0];
    throw new Error(`git ${command} failed: ${stderr || (err as Error).message}`);
  }
}
