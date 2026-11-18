import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getGitDiff } from "../local.js";

/**
 * A ref reaches getGitDiff from the HTTP API, the WebSocket and agents' MCP
 * calls. Against a real repository, a hostile one must fail as a bad
 * revision and do nothing else: run no command, write no file.
 */
describe("getGitDiff with a hostile ref (real git)", () => {
  let repo: string;
  let marker: string;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe", encoding: "utf-8" });

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "diffprism-ref-"));
    marker = path.join(repo, "pwned");
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    writeFileSync(path.join(repo, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "one");
    writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
    git("commit", "-q", "-am", "two");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("still diffs an ordinary range", () => {
    expect(getGitDiff("HEAD~1..HEAD", { cwd: repo })).toContain("+two");
  });

  it.each([
    'HEAD; touch "MARKER"',
    'HEAD && touch "MARKER"',
    '$(touch "MARKER")',
    '`touch "MARKER"`',
    'HEAD | touch "MARKER"',
  ])("does not run shell syntax in %s", (template) => {
    const ref = template.replace("MARKER", marker);
    expect(() => getGitDiff(ref, { cwd: repo })).toThrow("git diff failed");
    expect(existsSync(marker)).toBe(false);
  });

  it("does not treat a ref as a git option", () => {
    expect(() => getGitDiff(`--output=${marker}`, { cwd: repo })).toThrow("git diff failed");
    expect(existsSync(marker)).toBe(false);
  });
});
