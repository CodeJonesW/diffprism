import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  let includeUntracked = false;
  switch (ref) {
    case "staged":
      command = "git diff --staged --no-color";
      break;
    case "unstaged":
      command = "git diff --no-color";
      includeUntracked = true;
      break;
    case "all":
      command = "git diff HEAD --no-color";
      includeUntracked = true;
      break;
    default:
      command = `git diff --no-color ${ref}`;
      break;
  }

  let output: string;
  try {
    output = execSync(command, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(`git diff failed: ${message}`);
  }

  if (includeUntracked) {
    output += getUntrackedDiffs(cwd);
  }

  return output;
}

/**
 * Find untracked files and generate unified diff output for each one,
 * so they appear as "added" files in the parsed DiffSet.
 */
function getUntrackedDiffs(cwd: string): string {
  let untrackedList: string;
  try {
    untrackedList = execSync(
      "git ls-files --others --exclude-standard",
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  } catch {
    return "";
  }

  if (!untrackedList) return "";

  const files = untrackedList.split("\n");
  let result = "";

  for (const file of files) {
    const absPath = path.resolve(cwd, file);
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      // Binary or unreadable — skip
      continue;
    }

    const lines = content.split("\n");
    // If the file ends with a newline, the last split element is empty
    const hasTrailingNewline =
      content.length > 0 && content[content.length - 1] === "\n";
    const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines;

    result += `diff --git a/${file} b/${file}\n`;
    result += "new file mode 100644\n";
    result += "--- /dev/null\n";
    result += `+++ b/${file}\n`;
    result += `@@ -0,0 +1,${contentLines.length} @@\n`;

    for (const line of contentLines) {
      result += `+${line}\n`;
    }

    if (!hasTrailingNewline) {
      result += "\\ No newline at end of file\n";
    }
  }

  return result;
}
