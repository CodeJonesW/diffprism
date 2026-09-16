import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureServer, submitReviewToServer } from "@diffprism/core";
import type { ReviewComment, ReviewResult } from "@diffprism/core";
import { getDiff } from "@diffprism/git";

/**
 * Default size at which a staged change is worth a browser review.
 *
 * Deliberately not zero. A gate that stops every commit is one people learn to
 * skip with --no-verify, and a gate that is routinely skipped is worse than no
 * gate because you also lose the belief that it ran.
 */
const DEFAULT_MIN_LINES = 120;

const MARKER_START = "# >>> diffprism >>>";
const MARKER_END = "# <<< diffprism <<<";
const HOOK_LINE = "diffprism hook pre-commit || exit 1";

export interface HookFlags {
  minLines?: string;
  dev?: boolean;
}

// ─── pre-commit gate ───

export async function preCommitHook(flags: HookFlags = {}): Promise<void> {
  const cwd = process.cwd();
  const minLines = resolveMinLines(flags, cwd);

  let changedLines: number;
  try {
    const { diffSet } = getDiff("staged", { cwd });
    changedLines = diffSet.files.reduce(
      (total, file) => total + file.additions + file.deletions,
      0,
    );
  } catch (err) {
    fail(`Could not read the staged diff: ${message(err)}`);
    return;
  }

  if (changedLines === 0) {
    process.exit(0);
  }

  if (changedLines < minLines) {
    process.exit(0);
  }

  console.error(
    `${changedLines} staged lines (gate at ${minLines}) — opening DiffPrism review...`,
  );

  let review: ReviewResult | null = null;
  try {
    const serverInfo = await ensureServer({ dev: flags.dev });
    const { result } = await submitReviewToServer(serverInfo, "staged", {
      cwd,
      diffRef: "staged",
      title: "Pre-commit review",
    });
    review = result;
  } catch (err) {
    fail(`DiffPrism could not run the review: ${message(err)}`);
    return;
  }

  const decision = review?.decision;

  if (decision === "approved" || decision === "approved_with_comments") {
    const summary = review?.summary?.trim();
    const comments = review?.comments ?? [];
    if (summary || comments.length > 0) {
      printFeedback(review);
    }
    console.error(`Review: ${decision} — proceeding.`);
    process.exit(0);
  }

  if (decision === "changes_requested") {
    printFeedback(review);
    fail("Commit blocked: the review requested changes.");
    return;
  }

  if (decision === "dismissed") {
    fail("Commit blocked: the review was dismissed without a decision.");
    return;
  }

  // No decision came back at all. Failing closed on purpose: a gate that
  // cannot tell approval from rejection has no opinion, and a gate with no
  // opinion should not quietly wave a commit through.
  fail(
    `Commit blocked: no review decision was returned (got ${String(decision)}).`,
  );
}

/**
 * Echo everything the reviewer said into the failure output.
 *
 * The caller that just got a non-zero exit is usually an agent, and it only
 * sees what this command prints. Without the feedback it knows it was
 * rejected but not what to change, which stalls the loop on a round trip the
 * reviewer already paid for.
 *
 * A review carries feedback in two places and BOTH have to be read. General
 * remarks go in `summary` — the box above the decision buttons — while
 * `comments` holds per-line notes. A rejection that says "what is this??" in
 * the summary box and nothing inline is entirely normal, and printing only
 * the inline comments makes it look like the reviewer said nothing at all.
 */
export function printFeedback(review: ReviewResult | null): void {
  const summary = review?.summary?.trim();
  const comments = review?.comments ?? [];

  console.error("");

  if (!summary && comments.length === 0) {
    // Say so rather than printing nothing. Silence is indistinguishable from
    // a bug, and the agent needs to know to ask instead of guessing.
    console.error("  The review left no summary and no inline comments.");
    console.error("  Ask what needs changing — there is nothing here to act on.");
    console.error("");
    return;
  }

  if (summary) {
    for (const line of summary.split("\n")) {
      console.error(`  ${line}`);
    }
    if (comments.length > 0) {
      console.error("");
    }
  }

  for (const c of comments) {
    console.error(`  ${c.file}:${c.line}  [${c.type}]  ${c.body}`);
  }

  console.error("");
}

// ─── install / uninstall ───

export function installHook(): void {
  const hookPath = resolveHookPath(process.cwd());
  const existing = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, "utf8")
    : "";

  if (existing.includes(MARKER_START)) {
    console.log(`Already installed in ${hookPath}`);
    return;
  }

  const block = `${MARKER_START}\n${HOOK_LINE}\n${MARKER_END}\n`;
  const base = existing === "" ? "#!/bin/sh\n" : ensureTrailingNewline(existing);
  const created = existing === "";

  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, `${base}\n${block}`);
  fs.chmodSync(hookPath, 0o755);

  console.log(`${created ? "Created" : "Updated"} ${hookPath}`);
  console.log(
    `Staged changes of ${DEFAULT_MIN_LINES}+ lines now open a review before the commit lands.`,
  );
  console.log("Tune with:  git config diffprism.gate-lines <n>");
  console.log("Remove with: diffprism hook uninstall");
}

export function uninstallHook(): void {
  const hookPath = resolveHookPath(process.cwd());

  if (!fs.existsSync(hookPath)) {
    console.log("Nothing to remove — no hook file.");
    return;
  }

  const existing = fs.readFileSync(hookPath, "utf8");
  if (!existing.includes(MARKER_START)) {
    console.log(`Nothing to remove — no diffprism block in ${hookPath}`);
    return;
  }

  const cleaned = removeMarkedBlock(existing);

  // If all that is left is a shebang, the file only existed because we made
  // it. Leaving an inert hook behind is the kind of residue that makes an
  // uninstall feel untrustworthy.
  if (/^\s*(#![^\n]*)?\s*$/.test(cleaned)) {
    fs.rmSync(hookPath);
    console.log(`Removed ${hookPath} (it contained nothing else).`);
    return;
  }

  fs.writeFileSync(hookPath, cleaned);
  console.log(`Removed the diffprism block from ${hookPath}`);
}

export function removeMarkedBlock(contents: string): string {
  const lines = contents.split("\n");
  const out: string[] = [];
  let inside = false;

  for (const line of lines) {
    if (line.trim() === MARKER_START) {
      inside = true;
      continue;
    }
    if (line.trim() === MARKER_END) {
      inside = false;
      continue;
    }
    if (!inside) {
      out.push(line);
    }
  }

  return ensureTrailingNewline(out.join("\n").replace(/\n{3,}/g, "\n\n"));
}

// ─── helpers ───

export function resolveMinLines(flags: HookFlags, cwd: string): number {
  const fromFlag = flags.minLines ? Number.parseInt(flags.minLines, 10) : NaN;
  if (Number.isFinite(fromFlag) && fromFlag > 0) {
    return fromFlag;
  }

  const configured = Number.parseInt(
    git(["config", "--get", "diffprism.gate-lines"], cwd) ?? "",
    10,
  );
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_MIN_LINES;
}

/**
 * Where git will actually look for hooks — which is not always .git/hooks.
 * A repo that sets core.hooksPath (or a worktree, where .git is a file) puts
 * them somewhere else, and writing to the wrong place installs a hook that
 * silently never runs.
 */
export function resolveHookPath(cwd: string): string {
  const configured = git(["config", "--get", "core.hooksPath"], cwd);
  if (configured) {
    return path.resolve(cwd, configured, "pre-commit");
  }

  const hooksDir = git(["rev-parse", "--git-path", "hooks"], cwd) ?? ".git/hooks";
  return path.resolve(cwd, hooksDir, "pre-commit");
}

function git(args: string[], cwd: string): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(text: string): never {
  console.error(text);
  process.exit(1);
}
