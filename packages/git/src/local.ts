import { execSync } from "node:child_process";

/**
 * Shell out to `git diff` and return the raw unified diff text.
 *
 * @param ref - One of "staged", "unstaged", or an arbitrary git ref range (e.g. "HEAD~3..HEAD").
 * @param options.cwd - Working directory for the git command.  Defaults to process.cwd().
 */
export function getGitDiff(
  ref: string,
  options?: { cwd?: string },
): string {
  const cwd = options?.cwd ?? process.cwd();

  // Verify that git is available
  try {
    execSync("git --version", { cwd, stdio: "pipe" });
  } catch {
    throw new Error(
      "git is not available. Please install git and make sure it is on your PATH.",
    );
  }

  // Verify that we are inside a git repository
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
  } catch {
    throw new Error(
      `The directory "${cwd}" is not inside a git repository.`,
    );
  }

  // Build the git diff command
  let command: string;
  switch (ref) {
    case "staged":
      command = "git diff --staged --no-color";
      break;
    case "unstaged":
      command = "git diff --no-color";
      break;
    default:
      command = `git diff --no-color ${ref}`;
      break;
  }

  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    });
    return output;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(`git diff failed: ${message}`);
  }
}
