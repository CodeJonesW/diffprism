import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getGitDiff } from "../local.js";

// Mock child_process and fs
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const mockExecSync = vi.mocked(execSync);
const mockReadFileSync = vi.mocked(readFileSync);

/**
 * Set up execSync to pass git --version and git rev-parse checks,
 * then return the given diff output for the actual diff command.
 */
function setupGitMocks(diffOutput: string, untrackedList = "") {
  mockExecSync.mockImplementation((cmd: string, _opts?: unknown) => {
    const command = String(cmd);
    if (command === "git --version") return "git version 2.40.0";
    if (command === "git rev-parse --is-inside-work-tree") return "true";
    if (command === "git ls-files --others --exclude-standard")
      return untrackedList;
    // Any git diff command
    if (command.startsWith("git diff")) return diffOutput;
    return "";
  });
}

describe("getGitDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ref to command mapping", () => {
    it('maps "staged" to git diff --staged --no-color', () => {
      setupGitMocks("staged diff output");
      const result = getGitDiff("staged");

      const diffCall = mockExecSync.mock.calls.find(
        (c) => String(c[0]).startsWith("git diff"),
      );
      expect(String(diffCall?.[0])).toBe("git diff --staged --no-color");
      expect(result).toBe("staged diff output");
    });

    it('maps "unstaged" to git diff --no-color and includes untracked', () => {
      setupGitMocks("unstaged diff output", "");
      const result = getGitDiff("unstaged");

      const diffCall = mockExecSync.mock.calls.find(
        (c) => String(c[0]) === "git diff --no-color",
      );
      expect(diffCall).toBeDefined();
      expect(result).toBe("unstaged diff output");
    });

    it('maps "all" to git diff HEAD --no-color and includes untracked', () => {
      setupGitMocks("all diff output", "");
      const result = getGitDiff("all");

      const diffCall = mockExecSync.mock.calls.find(
        (c) => String(c[0]) === "git diff HEAD --no-color",
      );
      expect(diffCall).toBeDefined();
      expect(result).toBe("all diff output");
    });

    it("maps a custom ref range to git diff --no-color <ref>", () => {
      setupGitMocks("custom diff output");
      const result = getGitDiff("HEAD~3..HEAD");

      const diffCall = mockExecSync.mock.calls.find(
        (c) => String(c[0]).startsWith("git diff --no-color"),
      );
      expect(String(diffCall?.[0])).toBe(
        "git diff --no-color HEAD~3..HEAD",
      );
      expect(result).toBe("custom diff output");
    });
  });

  describe("error handling", () => {
    it("throws when git is not available", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (String(cmd) === "git --version") throw new Error("not found");
        return "";
      });

      expect(() => getGitDiff("staged")).toThrow(
        "git is not available",
      );
    });

    it("throws when not inside a git repository", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (String(cmd) === "git --version") return "git version 2.40.0";
        if (String(cmd) === "git rev-parse --is-inside-work-tree")
          throw new Error("not a repo");
        return "";
      });

      expect(() => getGitDiff("staged")).toThrow(
        "is not inside a git repository",
      );
    });

    it("throws with a descriptive message when git diff fails", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = String(cmd);
        if (command === "git --version") return "git version 2.40.0";
        if (command === "git rev-parse --is-inside-work-tree") return "true";
        if (command.startsWith("git diff"))
          throw new Error("fatal: bad revision");
        return "";
      });

      expect(() => getGitDiff("nonexistent..HEAD")).toThrow(
        "git diff failed",
      );
    });
  });

  describe("untracked files", () => {
    it('appends untracked file diffs for "unstaged" ref', () => {
      mockReadFileSync.mockReturnValue("line one\nline two\n");
      setupGitMocks("tracked diff\n", "newfile.ts");

      const result = getGitDiff("unstaged");

      expect(result).toContain("tracked diff");
      expect(result).toContain("diff --git a/newfile.ts b/newfile.ts");
      expect(result).toContain("new file mode 100644");
      expect(result).toContain("+line one");
      expect(result).toContain("+line two");
    });

    it('appends untracked file diffs for "all" ref', () => {
      mockReadFileSync.mockReturnValue("content\n");
      setupGitMocks("", "untracked.js");

      const result = getGitDiff("all");

      expect(result).toContain("diff --git a/untracked.js b/untracked.js");
    });

    it('does NOT include untracked files for "staged" ref', () => {
      setupGitMocks("staged diff");

      const result = getGitDiff("staged");

      // Should not call git ls-files
      const lsFilesCall = mockExecSync.mock.calls.find(
        (c) => String(c[0]).includes("ls-files"),
      );
      expect(lsFilesCall).toBeUndefined();
      expect(result).toBe("staged diff");
    });

    it("handles files without trailing newline", () => {
      mockReadFileSync.mockReturnValue("no trailing newline");
      setupGitMocks("", "notrail.txt");

      const result = getGitDiff("unstaged");

      expect(result).toContain("+no trailing newline");
      expect(result).toContain("\\ No newline at end of file");
    });

    it("skips unreadable files gracefully", () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("binary file");
      });
      setupGitMocks("", "binary.bin");

      const result = getGitDiff("unstaged");

      // Should not crash, just skip the unreadable file
      expect(result).not.toContain("binary.bin");
    });
  });

  describe("cwd option", () => {
    it("passes cwd to execSync", () => {
      setupGitMocks("");
      getGitDiff("staged", { cwd: "/tmp/my-repo" });

      for (const call of mockExecSync.mock.calls) {
        const opts = call[1] as { cwd?: string } | undefined;
        expect(opts?.cwd).toBe("/tmp/my-repo");
      }
    });
  });
});
