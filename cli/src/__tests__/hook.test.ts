import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("@diffprism/core", async () => {
  const actual = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
  class ReviewTimeoutError extends Error {
    readonly sessionId: string;
    readonly waitedMs: number;
    constructor(sessionId: string, waitedMs: number) {
      super("timed out");
      this.sessionId = sessionId;
      this.waitedMs = waitedMs;
    }
  }
  return {
    ensureServer: vi.fn(),
    submitReviewToServer: vi.fn(),
    ReviewTimeoutError,
    ReviewerAskedError: actual.ReviewerAskedError,
    COMMIT_GATE_DIFF_REF: actual.COMMIT_GATE_DIFF_REF,
    recordError: vi.fn(),
    REPORT_HINT: actual.REPORT_HINT,
  };
});

vi.mock("@diffprism/git", () => ({
  getDiff: vi.fn(),
}));

import { ensureServer, submitReviewToServer, ReviewTimeoutError, ReviewerAskedError } from "@diffprism/core";
import { getDiff } from "@diffprism/git";
import {
  preCommitHook,
  printFeedback,
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

describe("printFeedback", () => {
  function captured(): string {
    const spy = vi.mocked(console.error);
    return spy.mock.calls.map((c) => c[0]).join("\n");
  }

  it("prints the summary — the box most feedback is actually typed into", () => {
    // Regression: a rejection carrying only a summary printed nothing at all,
    // so the reviewer's words never reached the agent and the block looked
    // like it carried no reason.
    printFeedback({ decision: "changes_requested", comments: [], summary: "what is this?????" });

    expect(captured()).toContain("what is this?????");
  });

  it("prints inline comments with file, line, type and body", () => {
    printFeedback({
      decision: "changes_requested",
      comments: [
        { file: "src/a.ts", line: 12, side: "new", body: "drops the error", type: "must_fix" },
      ],
    });

    const out = captured();
    expect(out).toContain("src/a.ts:12");
    expect(out).toContain("[must_fix]");
    expect(out).toContain("drops the error");
  });

  it("says when a comment is on a deleted line, whose number counts in the old file (#175)", () => {
    printFeedback({
      decision: "changes_requested",
      comments: [
        { file: "src/a.ts", line: 12, side: "old", body: "why remove this?", type: "question" },
      ],
    });

    expect(captured()).toContain("src/a.ts:12 (deleted line)");
  });

  it("prints both when the reviewer left both", () => {
    printFeedback({
      decision: "changes_requested",
      summary: "this needs rethinking",
      comments: [
        { file: "src/a.ts", line: 3, side: "new", body: "here", type: "question" },
      ],
    });

    const out = captured();
    expect(out).toContain("this needs rethinking");
    expect(out).toContain("src/a.ts:3");
  });

  it("indents every line of a multi-line summary", () => {
    printFeedback({
      decision: "changes_requested",
      comments: [],
      summary: "first line\nsecond line",
    });

    const out = captured();
    expect(out).toContain("  first line");
    expect(out).toContain("  second line");
  });

  it("says so when a rejection carried nothing at all", () => {
    // Silence is indistinguishable from a bug — the agent has to be told
    // there is nothing to act on, so it asks instead of guessing.
    printFeedback({ decision: "changes_requested", comments: [] });

    expect(captured()).toContain("no summary and no inline comments");
  });

  it("treats a whitespace-only summary as empty", () => {
    printFeedback({ decision: "changes_requested", comments: [], summary: "   " });

    expect(captured()).toContain("no summary and no inline comments");
  });
});

describe("preCommitHook while waiting for a decision (#161)", () => {
  class Exit extends Error {
    constructor(readonly code: number | undefined) {
      super(`exit ${code}`);
    }
  }

  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Exit(code);
    }) as never);
    mockGit.mockImplementation(() => {
      throw new Error("no config");
    });
    vi.mocked(getDiff).mockReturnValue({
      diffSet: {
        baseRef: "HEAD",
        headRef: "staged",
        files: [{ path: "a.ts", status: "modified", hunks: [], language: "typescript", binary: false, additions: 200, deletions: 0 }],
      },
      rawDiff: "diff",
    } as never);
    vi.mocked(ensureServer).mockResolvedValue({ httpPort: 1, wsPort: 2, pid: 3, startedAt: 4 });
  });

  afterEach(() => {
    vi.mocked(process.exit).mockRestore();
  });

  async function run(): Promise<number | undefined> {
    try {
      await preCommitHook();
    } catch (err) {
      if (err instanceof Exit) return err.code;
      throw err;
    }
    return undefined;
  }

  it("says the review outlives the command before it starts waiting", async () => {
    // A shell timeout can end the hook with SIGKILL, which no handler sees,
    // so the advice has to be on screen before the wait — not only after it.
    let adviceBeforeWait = false;
    vi.mocked(submitReviewToServer).mockImplementation(async () => {
      adviceBeforeWait = errors.some((line) => line.includes("run git commit again"));
      return { result: { decision: "approved", comments: [] }, sessionId: "s1" };
    });

    expect(await run()).toBe(0);
    expect(adviceBeforeWait).toBe(true);
  });

  it("reviews staged changes only, unlike interactive reviews (#164)", async () => {
    vi.mocked(submitReviewToServer).mockResolvedValue({
      result: { decision: "approved", comments: [] },
      sessionId: "s1",
    });

    await run();

    expect(vi.mocked(getDiff)).toHaveBeenCalledWith("staged", expect.anything());
    expect(vi.mocked(submitReviewToServer)).toHaveBeenCalledWith(
      expect.anything(),
      "staged",
      expect.objectContaining({ diffRef: "staged" }),
    );
  });

  it("blocks with retry advice, not a bare error, when the wait runs out", async () => {
    vi.mocked(submitReviewToServer).mockRejectedValue(new ReviewTimeoutError("s1", 600_000));

    expect(await run()).toBe(1);
    const last = errors.at(-1) ?? "";
    expect(last).toContain("no decision after 600s");
    expect(last).toContain("run git commit again");
  });

  it("blocks with the reviewer's questions and how to answer them (#177)", async () => {
    const question = {
      id: "q1", sessionId: "s1", file: "src/a.ts", line: 3, side: "new" as const, body: "Why a Map?", type: "question" as const,
      confidence: 1, category: "other" as const, source: { agent: "reviewer" }, createdAt: 1, author: "agent" as const,
      replies: [{ id: "r1", author: "reviewer" as const, body: "And why not a Set?", createdAt: 2 }],
    };
    vi.mocked(submitReviewToServer).mockRejectedValue(new ReviewerAskedError("s1", [question]));

    expect(await run()).toBe(1);
    const output = errors.join("\n");
    // The last thing said in the thread is the question to answer.
    expect(output).toContain("src/a.ts:3");
    expect(output).toContain("And why not a Set?");
    // An agent with only a shell can act on this: the exact command, not an MCP tool it may not have (#179).
    expect(output).toContain('Answer: diffprism reply --session s1 q1 "<your answer>"');
    const last = errors.at(-1) ?? "";
    expect(last).toContain("run git commit again");
  });

  it("repeats the advice if it is interrupted mid-review", async () => {
    vi.mocked(submitReviewToServer).mockImplementation(() => new Promise(() => {}));

    const pending = run();
    await new Promise((resolve) => setTimeout(resolve, 10));

    let code: number | undefined;
    try {
      process.emit("SIGTERM", "SIGTERM");
    } catch (err) {
      if (err instanceof Exit) code = err.code;
      else throw err;
    }
    void pending;

    expect(code).toBe(1);
    expect(errors.some((line) => line.includes("Interrupted (SIGTERM)") && line.includes("run git commit again"))).toBe(true);
  });

  it("stops listening for interrupts once a decision arrives", async () => {
    const before = process.listenerCount("SIGTERM");
    vi.mocked(submitReviewToServer).mockResolvedValue({
      result: { decision: "approved", comments: [] },
      sessionId: "s1",
    });

    await run();

    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});
