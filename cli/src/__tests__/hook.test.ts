import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

// The gate imports these at module level; nothing here exercises them.
vi.mock("@diffprism/core", () => ({
  ensureServer: vi.fn(),
  submitReviewToServer: vi.fn(),
}));

vi.mock("@diffprism/git", () => ({
  getDiff: vi.fn(),
}));

import {
  printComments,
  removeMarkedBlock,
  resolveMinLines,
  resolveHookPath,
  installHook,
  uninstallHook,
} from "../commands/hook.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockRmSync = vi.mocked(fs.rmSync);
const mockGit = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Make every `git ...` lookup fail, as it would outside a repo. */
function gitUnavailable(): void {
  mockGit.mockImplementation(() => {
    throw new Error("not a git repository");
  });
}

/** Answer specific `git` argument lists, failing all others. */
function gitAnswers(answers: Record<string, string>): void {
  mockGit.mockImplementation((_cmd, args) => {
    const key = (args as string[]).join(" ");
    if (key in answers) return answers[key];
    throw new Error(`no answer for: ${key}`);
  });
}

describe("removeMarkedBlock", () => {
  it("removes the diffprism block and leaves everything else", () => {
    const hook = [
      "#!/bin/sh",
      "npm run lint || exit 1",
      "# >>> diffprism >>>",
      "diffprism hook pre-commit || exit 1",
      "# <<< diffprism <<<",
      "npm test || exit 1",
      "",
    ].join("\n");

    const cleaned = removeMarkedBlock(hook);

    expect(cleaned).toContain("npm run lint || exit 1");
    expect(cleaned).toContain("npm test || exit 1");
    expect(cleaned).not.toContain("diffprism");
  });

  it("leaves content untouched when there is no block", () => {
    const hook = "#!/bin/sh\nnpm test || exit 1\n";
    expect(removeMarkedBlock(hook)).toBe(hook);
  });

  it("reduces a hook that held only our block to its shebang", () => {
    const hook = [
      "#!/bin/sh",
      "",
      "# >>> diffprism >>>",
      "diffprism hook pre-commit || exit 1",
      "# <<< diffprism <<<",
      "",
    ].join("\n");

    expect(removeMarkedBlock(hook).trim()).toBe("#!/bin/sh");
  });
});

describe("resolveMinLines", () => {
  it("prefers an explicit flag", () => {
    gitAnswers({ "config --get diffprism.gate-lines": "300" });
    expect(resolveMinLines({ minLines: "40" }, "/repo")).toBe(40);
  });

  it("falls back to git config", () => {
    gitAnswers({ "config --get diffprism.gate-lines": "300" });
    expect(resolveMinLines({}, "/repo")).toBe(300);
  });

  it("defaults to 120 when nothing is configured", () => {
    gitUnavailable();
    expect(resolveMinLines({}, "/repo")).toBe(120);
  });

  it("ignores a non-numeric or non-positive config value", () => {
    gitAnswers({ "config --get diffprism.gate-lines": "nonsense" });
    expect(resolveMinLines({}, "/repo")).toBe(120);

    gitAnswers({ "config --get diffprism.gate-lines": "0" });
    expect(resolveMinLines({}, "/repo")).toBe(120);
  });
});

describe("resolveHookPath", () => {
  it("honours core.hooksPath when the repo sets one", () => {
    gitAnswers({ "config --get core.hooksPath": ".githooks" });
    expect(resolveHookPath("/repo")).toBe("/repo/.githooks/pre-commit");
  });

  it("asks git where hooks live when core.hooksPath is unset", () => {
    gitAnswers({ "rev-parse --git-path hooks": ".git/hooks" });
    expect(resolveHookPath("/repo")).toBe("/repo/.git/hooks/pre-commit");
  });

  it("follows git's answer for a worktree, where .git is a file", () => {
    gitAnswers({
      "rev-parse --git-path hooks": "/repo/.git/worktrees/wt/hooks",
    });
    expect(resolveHookPath("/repo")).toBe("/repo/.git/worktrees/wt/hooks/pre-commit");
  });
});

describe("installHook", () => {
  beforeEach(() => {
    gitAnswers({ "rev-parse --git-path hooks": ".git/hooks" });
  });

  it("creates a hook with a shebang when none exists", () => {
    mockExistsSync.mockReturnValue(false);

    installHook();

    const [, written] = mockWriteFileSync.mock.calls[0];
    expect(written).toContain("#!/bin/sh");
    expect(written).toContain("diffprism hook pre-commit || exit 1");
  });

  it("appends to an existing hook without destroying it", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("#!/bin/sh\nnpm test || exit 1\n");

    installHook();

    const [, written] = mockWriteFileSync.mock.calls[0];
    expect(written).toContain("npm test || exit 1");
    expect(written).toContain("diffprism hook pre-commit || exit 1");
  });

  it("is idempotent — a second install writes nothing", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "#!/bin/sh\n# >>> diffprism >>>\ndiffprism hook pre-commit || exit 1\n# <<< diffprism <<<\n",
    );

    installHook();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("uninstallHook", () => {
  beforeEach(() => {
    gitAnswers({ "rev-parse --git-path hooks": ".git/hooks" });
  });

  it("removes only our block, preserving the rest", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "#!/bin/sh\nnpm test || exit 1\n# >>> diffprism >>>\ndiffprism hook pre-commit || exit 1\n# <<< diffprism <<<\n",
    );

    uninstallHook();

    const [, written] = mockWriteFileSync.mock.calls[0];
    expect(written).toContain("npm test || exit 1");
    expect(written).not.toContain("diffprism");
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("deletes a hook that contained nothing but our block", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "#!/bin/sh\n\n# >>> diffprism >>>\ndiffprism hook pre-commit || exit 1\n# <<< diffprism <<<\n",
    );

    uninstallHook();

    expect(mockRmSync).toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("does nothing when the hook has no diffprism block", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("#!/bin/sh\nnpm test || exit 1\n");

    uninstallHook();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("does nothing when there is no hook file at all", () => {
    mockExistsSync.mockReturnValue(false);

    uninstallHook();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});

describe("printComments", () => {
  it("reports each comment with file, line, type and body", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    printComments([
      { file: "src/a.ts", line: 12, body: "drops the error", type: "must_fix" },
      { file: "src/b.ts", line: 7, body: "inclusive?", type: "question" },
    ]);

    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("src/a.ts:12");
    expect(output).toContain("[must_fix]");
    expect(output).toContain("drops the error");
    expect(output).toContain("src/b.ts:7");
    expect(output).toContain("[question]");
  });

  it("stays quiet when a rejection carried no comments", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    printComments([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
