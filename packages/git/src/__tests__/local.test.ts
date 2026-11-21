import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGitDiff, getGitHubRemotes, listBranches, listCommits } from "../local.js";

// Mock child_process and fs
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const mockExecSync = vi.mocked(execSync);
const mockExecFileSync = vi.mocked(execFileSync);
const mockReadFileSync = vi.mocked(readFileSync);

/**
 * Set up execSync to pass git --version and git rev-parse checks, and
 * execFileSync to return the given diff output for the git diff call.
 */
function setupGitMocks(diffOutput: string, untrackedList = "") {
  mockExecSync.mockImplementation((cmd: string, _opts?: unknown) => {
    const command = String(cmd);
    if (command === "git --version") return "git version 2.40.0";
    if (command === "git rev-parse --is-inside-work-tree") return "true";
    if (command === "git ls-files --others --exclude-standard")
      return untrackedList;
    return "";
  });
  mockExecFileSync.mockReturnValue(diffOutput);
}

/** The argv of the single git diff call. */
function diffArgs(): readonly string[] {
  expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  const [file, args] = mockExecFileSync.mock.calls[0];
  expect(file).toBe("git");
  return args as readonly string[];
}

describe("getGitDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ref to argv mapping", () => {
    it('maps "staged" to git diff --staged --no-color', () => {
      setupGitMocks("staged diff output");
      const result = getGitDiff("staged");

      expect(diffArgs()).toEqual(["diff", "--staged", "--no-color"]);
      expect(result).toBe("staged diff output");
    });

    it('maps "unstaged" to git diff --no-color and includes untracked', () => {
      setupGitMocks("unstaged diff output", "");
      const result = getGitDiff("unstaged");

      expect(diffArgs()).toEqual(["diff", "--no-color"]);
      expect(result).toBe("unstaged diff output");
    });

    it('maps "all" to git diff HEAD --no-color and includes untracked', () => {
      setupGitMocks("all diff output", "");
      const result = getGitDiff("all");

      expect(diffArgs()).toEqual(["diff", "HEAD", "--no-color"]);
      expect(result).toBe("all diff output");
    });

    it("passes a custom ref range as one argument after --end-of-options", () => {
      setupGitMocks("custom diff output");
      const result = getGitDiff("HEAD~3..HEAD");

      expect(diffArgs()).toEqual([
        "diff",
        "--no-color",
        "--end-of-options",
        "HEAD~3..HEAD",
        "--",
      ]);
      expect(result).toBe("custom diff output");
    });

    it("passes shell metacharacters and option-like refs through as one literal argument", () => {
      for (const ref of ["HEAD; touch pwned", "$(id)", "`id`", "--output=/tmp/x"]) {
        vi.clearAllMocks();
        setupGitMocks("");
        getGitDiff(ref);

        expect(diffArgs()).toEqual(["diff", "--no-color", "--end-of-options", ref, "--"]);
        // Nothing built from the ref ever reaches a shell.
        for (const [cmd] of mockExecSync.mock.calls) {
          expect(String(cmd)).not.toContain(ref);
        }
      }
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
      setupGitMocks("");
      mockExecFileSync.mockImplementation(() => {
        throw new Error("fatal: bad revision");
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
    it("passes cwd to every git call", () => {
      setupGitMocks("");
      getGitDiff("staged", { cwd: "/tmp/my-repo" });

      expect(
        (mockExecFileSync.mock.calls[0][2] as { cwd?: string }).cwd,
      ).toBe("/tmp/my-repo");
      for (const call of mockExecSync.mock.calls) {
        const opts = call[1] as { cwd?: string } | undefined;
        expect(opts?.cwd).toBe("/tmp/my-repo");
      }
    });
  });
});

describe("getGitHubRemotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists each GitHub repo once, lowercased, from ssh and https remotes", () => {
    mockExecSync.mockReturnValue(
      [
        "origin\tgit@github.com:CodeJonesW/park-smart.git (fetch)",
        "origin\tgit@github.com:CodeJonesW/park-smart.git (push)",
        "upstream\thttps://github.com/acme/widget (fetch)",
        "mirror\thttps://gitlab.com/acme/other.git (fetch)",
        "",
      ].join("\n"),
    );

    expect(getGitHubRemotes({ cwd: "/repo" })).toEqual(["codejonesw/park-smart", "acme/widget"]);
  });

  it("is empty outside a git repository", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(getGitHubRemotes({ cwd: "/nowhere" })).toEqual([]);
  });
});

describe("listBranches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("separates local and remote branches", () => {
    mockExecSync.mockReturnValue("main\nfeature-x\norigin/main\norigin/develop\n");

    const result = listBranches();

    expect(result.local).toEqual(["main", "feature-x"]);
    expect(result.remote).toEqual(["origin/main", "origin/develop"]);
  });

  it("skips HEAD pointer entries", () => {
    mockExecSync.mockReturnValue("main\norigin/HEAD\norigin/main\n");

    const result = listBranches();

    expect(result.local).toEqual(["main"]);
    expect(result.remote).toEqual(["origin/main"]);
  });

  it("returns empty arrays on failure", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    const result = listBranches();

    expect(result.local).toEqual([]);
    expect(result.remote).toEqual([]);
  });

  it("returns empty arrays for empty output", () => {
    mockExecSync.mockReturnValue("");

    const result = listBranches();

    expect(result.local).toEqual([]);
    expect(result.remote).toEqual([]);
  });

  it("passes cwd option to execSync", () => {
    mockExecSync.mockReturnValue("main\n");

    listBranches({ cwd: "/my/repo" });

    const opts = mockExecSync.mock.calls[0][1] as { cwd?: string };
    expect(opts.cwd).toBe("/my/repo");
  });
});

describe("listCommits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses commit log output", () => {
    mockExecFileSync.mockReturnValue(
      "abc123full<<>>abc123<<>>Initial commit<<>>John Doe<<>>2025-01-15T10:30:00Z\n" +
      "def456full<<>>def456<<>>Add feature<<>>Jane Doe<<>>2025-01-14T09:00:00Z\n",
    );

    const result = listCommits();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      hash: "abc123full",
      shortHash: "abc123",
      subject: "Initial commit",
      author: "John Doe",
      date: "2025-01-15T10:30:00Z",
    });
    expect(result[1].shortHash).toBe("def456");
  });

  it("returns empty array on failure", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    const result = listCommits();

    expect(result).toEqual([]);
  });

  it("returns empty array for empty output", () => {
    mockExecFileSync.mockReturnValue("");

    const result = listCommits();

    expect(result).toEqual([]);
  });

  it("uses custom limit", () => {
    mockExecFileSync.mockReturnValue("");

    listCommits({ limit: 10 });

    const [file, args] = mockExecFileSync.mock.calls[0];
    expect(file).toBe("git");
    expect(args).toEqual(["log", "--format=%H<<>>%h<<>>%s<<>>%an<<>>%aI", "-n", "10"]);
  });

  it("skips malformed lines", () => {
    mockExecFileSync.mockReturnValue(
      "abc123full<<>>abc123<<>>Good commit<<>>Author<<>>2025-01-15T10:30:00Z\nbad line\n",
    );

    const result = listCommits();

    expect(result).toHaveLength(1);
    expect(result[0].shortHash).toBe("abc123");
  });
});
