import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectWorktree } from "../local.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { execSync } from "node:child_process";

const mockExecSync = vi.mocked(execSync);

describe("detectWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns isWorktree: false in a normal repository", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command === "git rev-parse --git-dir") return ".git";
      if (command === "git rev-parse --git-common-dir") return ".git";
      return "";
    });

    const result = detectWorktree({ cwd: "/my/repo" });

    expect(result).toEqual({ isWorktree: false });
  });

  it("detects a linked worktree when git-dir and git-common-dir differ", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command === "git rev-parse --git-dir")
        return "/main/repo/.git/worktrees/feature-branch";
      if (command === "git rev-parse --git-common-dir")
        return "/main/repo/.git";
      if (command === "git rev-parse --show-toplevel")
        return "/worktrees/feature-branch";
      if (command === "git rev-parse --abbrev-ref HEAD")
        return "feature-branch";
      return "";
    });

    const result = detectWorktree({ cwd: "/worktrees/feature-branch" });

    expect(result.isWorktree).toBe(true);
    expect(result.worktreePath).toBe("/worktrees/feature-branch");
    expect(result.mainWorktreePath).toBe("/main/repo");
    expect(result.branch).toBe("feature-branch");
  });

  it("returns isWorktree: false when git commands fail", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    const result = detectWorktree();

    expect(result).toEqual({ isWorktree: false });
  });

  it("passes cwd option to execSync", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command === "git rev-parse --git-dir") return ".git";
      if (command === "git rev-parse --git-common-dir") return ".git";
      return "";
    });

    detectWorktree({ cwd: "/custom/path" });

    for (const call of mockExecSync.mock.calls) {
      const opts = call[1] as { cwd?: string } | undefined;
      expect(opts?.cwd).toBe("/custom/path");
    }
  });

  it("returns undefined branch when HEAD is detached", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command === "git rev-parse --git-dir")
        return "/main/repo/.git/worktrees/detached";
      if (command === "git rev-parse --git-common-dir")
        return "/main/repo/.git";
      if (command === "git rev-parse --show-toplevel")
        return "/worktrees/detached";
      if (command === "git rev-parse --abbrev-ref HEAD") return "HEAD";
      return "";
    });

    const result = detectWorktree({ cwd: "/worktrees/detached" });

    expect(result.isWorktree).toBe(true);
    expect(result.branch).toBeUndefined();
  });

  it("resolves relative git-dir paths against cwd", () => {
    // When inside a worktree, --git-dir may return a relative path
    // like "../.git/worktrees/my-branch"
    mockExecSync.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command === "git rev-parse --git-dir")
        return "../main-repo/.git/worktrees/my-branch";
      if (command === "git rev-parse --git-common-dir")
        return "../main-repo/.git";
      if (command === "git rev-parse --show-toplevel")
        return "/projects/my-branch";
      if (command === "git rev-parse --abbrev-ref HEAD") return "my-branch";
      return "";
    });

    const result = detectWorktree({ cwd: "/projects/my-branch" });

    expect(result.isWorktree).toBe(true);
    expect(result.worktreePath).toBe("/projects/my-branch");
    expect(result.branch).toBe("my-branch");
  });
});
