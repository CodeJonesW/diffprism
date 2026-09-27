import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DiffNewSide } from "@diffprism/core";

/** node:path, or its win32 form, so Windows paths can be checked on any machine. */
type PlatformPath = typeof path;

// ─── Reading a file for get_file_context (#260, #263) ───
//
// `file` and `ref` both come from an agent reading the code under review, so
// both are untrusted: a prompt injection in a diff can choose them. Nothing
// is read outside the repo, nothing in .git, and nothing git would take as an
// option.

/** The most a read returns, the same for git and the working tree. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type FileContext = { ok: true; content: string; readFrom: string } | { ok: false; error: string };

/**
 * `file` as a path inside `root`, with forward slashes as git wants it, or
 * null when it isn't one: absolute, climbing out with `..`, or (on Windows)
 * drive-relative, like `C:..\x`. Resolving against the root catches every
 * form, where checking how the path is written missed some (#263).
 */
export function pathInRepo(file: string, root: string, p: PlatformPath = path): string | null {
  if (!file || p.isAbsolute(file)) return null;
  const rel = p.relative(root, p.resolve(root, file));
  if (!rel || rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return null;
  return rel.split(p.sep).join("/");
}

/** Git's own files, which aren't the code under review: config, hooks, credentials. */
function inGitDir(rel: string): boolean {
  return rel.split("/").some((segment) => segment.toLowerCase() === ".git");
}

/**
 * Why `ref` can't be used, or null when it can. Git reads a leading `-` as an
 * option, and `--output=` writes a file (#263). No ref contains `:`, which
 * would make it a path of its own.
 */
export function refProblem(ref: string): string | null {
  if (!ref.trim()) return "The ref is empty.";
  if (ref.startsWith("-")) return `"${ref}" isn't a ref: it starts with "-".`;
  if (ref.includes(":")) return `"${ref}" isn't a ref: it contains ":".`;
  return null;
}

/** What went wrong with a `git show`, in words; "not found" only when git says so (#263). */
function gitReadError(err: unknown, file: string, where: string, ref?: string): string {
  const e = err as { code?: string; stderr?: string; message?: string };
  if (e.code === "ENOBUFS") return `"${file}" is too large to read (over ${MAX_FILE_BYTES / 1024 / 1024} MB).`;
  const stderr = String(e.stderr ?? "").trim();
  if (/does not exist|exists on disk, but not in/.test(stderr)) return `File not found: "${file}" ${where}.`;
  if (ref && /invalid object name|unknown revision|bad revision/.test(stderr)) {
    return `"${ref}" isn't a revision in this repository.`;
  }
  return `git couldn't read "${file}" ${where}: ${stderr || e.message || "unknown error"}`;
}

function gitShow(root: string, spec: string): string {
  // --end-of-options: whatever the spec is, git never takes it as an option.
  return execFileSync("git", ["show", "--end-of-options", spec], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: MAX_FILE_BYTES,
  });
}

/**
 * The working tree's copy, opened once. A path that's missing and one that
 * leads outside the repo through a symlink get the same answer, so the error
 * doesn't say whether a file outside exists. Only a regular file is read: a
 * named pipe would block the read forever.
 *
 * Two guarantees are Unix-only, because Windows has neither open flag: that
 * the last step can't be swapped for a symlink between the check and the
 * open, and that opening a pipe doesn't wait. Windows keeps the rest, and its
 * named pipes don't live in the repo's folders.
 */
function readWorkingTree(root: string, rel: string): FileContext {
  const unreadable: FileContext = {
    ok: false,
    error: `"${rel}" can't be read from the working tree: it's missing, or it leads outside the repository.`,
  };
  let real: string;
  let realRoot: string;
  try {
    real = fs.realpathSync(path.join(root, rel));
    realRoot = fs.realpathSync(root);
  } catch {
    return unreadable;
  }
  const inside = pathInRepo(path.relative(realRoot, real), realRoot);
  if (!inside) return unreadable;
  if (inGitDir(inside)) return { ok: false, error: `"${rel}" leads into .git, which isn't part of the code under review.` };

  let fd: number;
  try {
    // O_NOFOLLOW: the last step can't be swapped for a symlink after the check.
    // O_NONBLOCK: opening a named pipe returns at once instead of waiting.
    // Both are Unix-only; see above.
    fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  } catch {
    return unreadable;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return { ok: false, error: `"${rel}" isn't a regular file.` };
    // Read one byte past the limit, never more: the limit holds even for a
    // file that grows while it's read.
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_FILE_BYTES) {
      return { ok: false, error: `"${rel}" is too large to read (over ${MAX_FILE_BYTES / 1024 / 1024} MB).` };
    }
    return { ok: true, content: buffer.toString("utf-8", 0, length), readFrom: "working tree" };
  } finally {
    fs.closeSync(fd);
  }
}

/** Read `file` from the repo at `root`, in the version `side` names. */
export function readFileContext(root: string, file: string, side: DiffNewSide): FileContext {
  const rel = pathInRepo(file, root);
  if (!rel) return { ok: false, error: `"${file}" isn't a path inside the repository.` };
  if (inGitDir(rel)) return { ok: false, error: `"${file}" is inside .git, which isn't part of the code under review.` };

  switch (side.kind) {
    case "working-tree":
      return readWorkingTree(root, rel);
    case "index":
      // The stage is always named. Git reads `:0:b.ts` as stage 0 of `b.ts`,
      // so a file called `0:b.ts` sent as `:${rel}` would be read as another
      // path than the one checked. After an explicit `:0:`, the rest is
      // taken literally (#263).
      try {
        return { ok: true, content: gitShow(root, `:0:${rel}`), readFrom: "staged" };
      } catch (err) {
        return { ok: false, error: gitReadError(err, rel, "in the staged changes") };
      }
    case "commit": {
      const problem = refProblem(side.ref);
      if (problem) return { ok: false, error: problem };
      // A file missing at the ref asked for is missing there. Any other copy
      // of it, such as the working tree's, would be the wrong code (#240).
      try {
        return { ok: true, content: gitShow(root, `${side.ref}:${rel}`), readFrom: side.ref };
      } catch (err) {
        return { ok: false, error: gitReadError(err, rel, `at ${side.ref}`, side.ref) };
      }
    }
  }
}
