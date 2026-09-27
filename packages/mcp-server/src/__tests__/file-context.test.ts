import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_FILE_BYTES, pathInRepo, readFileContext, refProblem } from "../file-context.js";

// ─── #263: `file` and `ref` are both an agent's, and both untrusted ───

describe("pathInRepo", () => {
  it("keeps a path inside the repo, normalized, with forward slashes", () => {
    expect(pathInRepo("src/./a.ts", "/repo")).toBe("src/a.ts");
    expect(pathInRepo("src/x/../a.ts", "/repo")).toBe("src/a.ts");
  });

  it("refuses one that climbs out, however it's written", () => {
    expect(pathInRepo("../x", "/repo")).toBeNull();
    expect(pathInRepo("sub/../../secret", "/repo")).toBeNull();
    expect(pathInRepo("/etc/passwd", "/repo")).toBeNull();
    expect(pathInRepo("", "/repo")).toBeNull();
    expect(pathInRepo(".", "/repo")).toBeNull();
  });

  it("refuses Windows drive-relative and other-drive paths", () => {
    expect(pathInRepo("C:..\\..\\Windows\\win.ini", "C:\\repo", path.win32)).toBeNull();
    expect(pathInRepo("D:secret", "C:\\repo", path.win32)).toBeNull();
    expect(pathInRepo("D:\\secret", "C:\\repo", path.win32)).toBeNull();
    expect(pathInRepo("src\\a.ts", "C:\\repo", path.win32)).toBe("src/a.ts");
  });
});

describe("refProblem", () => {
  it("refuses a ref git would take as an option, or that holds a path", () => {
    expect(refProblem("--output=/tmp/pwn")).toContain('starts with "-"');
    expect(refProblem("HEAD:../../.ssh/id_rsa")).toContain('contains ":"');
    expect(refProblem(" ")).toBe("The ref is empty.");
    expect(refProblem("origin/main")).toBeNull();
    expect(refProblem("HEAD~2")).toBeNull();
  });
});

describe("readFileContext", () => {
  let repo: string;
  let outside: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "file-context-repo-")));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "file-context-outside-")));
    fs.writeFileSync(path.join(outside, "secret"), "do not read\n");
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(repo, "a.ts"), "committed\n");
    git("add", "a.ts");
    git("commit", "-qm", "one");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const commit = (ref: string) => ({ kind: "commit" as const, ref });

  it("never passes an option to git through the ref, so nothing gets written", () => {
    const pwn = path.join(repo, "pwn");
    const read = readFileContext(repo, "a.ts", commit(`--output=${pwn}`));
    expect(read).toEqual({ ok: false, error: expect.stringContaining('starts with "-"') });
    expect(fs.readdirSync(repo).filter((f) => f.startsWith("pwn"))).toEqual([]);
  });

  it("uses the checked path, not the one it was given", () => {
    expect(readFileContext(repo, "x/../a.ts", commit("HEAD"))).toEqual({ ok: true, content: "committed\n", readFrom: "HEAD" });
    for (const side of [commit("HEAD"), { kind: "index" as const }, { kind: "working-tree" as const }]) {
      expect(readFileContext(repo, "sub/../../secret", side)).toEqual({
        ok: false,
        error: '"sub/../../secret" isn\'t a path inside the repository.',
      });
    }
  });

  it("doesn't read git's own files", () => {
    for (const side of [commit("HEAD"), { kind: "index" as const }, { kind: "working-tree" as const }]) {
      const read = readFileContext(repo, ".git/config", side);
      expect(read.ok).toBe(false);
      expect(!read.ok && read.error).toContain("inside .git");
    }
    // Nor through a symlink that leads there.
    fs.symlinkSync(path.join(repo, ".git", "config"), path.join(repo, "config-link"));
    const linked = readFileContext(repo, "config-link", { kind: "working-tree" });
    expect(!linked.ok && linked.error).toContain("leads into .git");
  });

  it("answers the same for a symlink out of the repo whether or not its target exists", () => {
    fs.symlinkSync(path.join(outside, "secret"), path.join(repo, "to-existing"));
    fs.symlinkSync(path.join(outside, "missing"), path.join(repo, "to-missing"));
    const existing = readFileContext(repo, "to-existing", { kind: "working-tree" });
    const missing = readFileContext(repo, "to-missing", { kind: "working-tree" });
    const message = (r: typeof existing, name: string) => !r.ok && r.error.replace(name, "<file>");
    expect(message(existing, "to-existing")).toBe(message(missing, "to-missing"));
    expect(!existing.ok && existing.error).not.toContain("do not read");
  });

  it.skipIf(process.platform === "win32")("refuses a named pipe instead of waiting on it forever", () => {
    execFileSync("mkfifo", [path.join(repo, "pipe")]);
    expect(readFileContext(repo, "pipe", { kind: "working-tree" })).toEqual({ ok: false, error: '"pipe" isn\'t a regular file.' });
  });

  it("refuses a working-tree file over the size limit", () => {
    fs.writeFileSync(path.join(repo, "big.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
    const read = readFileContext(repo, "big.bin", { kind: "working-tree" });
    expect(!read.ok && read.error).toContain("too large to read");
  });

  it("reads a staged file by the path that was checked, not a stage prefix inside it", () => {
    fs.writeFileSync(path.join(repo, "b.ts"), "staged b\n");
    git("add", "b.ts");
    // `:0:b.ts` is git's "stage 0 of b.ts": a file called `0:b.ts` must not read as b.ts.
    expect(readFileContext(repo, "0:b.ts", { kind: "index" })).toEqual({
      ok: false,
      error: 'File not found: "0:b.ts" in the staged changes.',
    });
    // Nor reach .git, or an absolute path, through the prefix.
    for (const file of ["0:.git/config", "0:/etc/passwd"]) {
      const read = readFileContext(repo, file, { kind: "index" });
      expect(read.ok).toBe(false);
      expect(!read.ok && read.error).toContain("File not found");
    }
    // A file really named with a colon reads as itself.
    fs.writeFileSync(path.join(repo, "0:c.ts"), "named 0:c.ts\n");
    git("add", "--", "0:c.ts");
    expect(readFileContext(repo, "0:c.ts", { kind: "index" })).toEqual({ ok: true, content: "named 0:c.ts\n", readFrom: "staged" });
  });

  it("reads a working-tree file right up to the size limit", () => {
    fs.writeFileSync(path.join(repo, "exact.bin"), Buffer.alloc(MAX_FILE_BYTES, "a"));
    const read = readFileContext(repo, "exact.bin", { kind: "working-tree" });
    expect(read.ok && read.content.length).toBe(MAX_FILE_BYTES);
  });

  it("says a missing file is missing, and a bad ref is a bad ref", () => {
    expect(readFileContext(repo, "nope.ts", commit("HEAD"))).toEqual({ ok: false, error: 'File not found: "nope.ts" at HEAD.' });
    expect(readFileContext(repo, "nope.ts", { kind: "index" })).toEqual({
      ok: false,
      error: 'File not found: "nope.ts" in the staged changes.',
    });
    expect(readFileContext(repo, "a.ts", commit("no-such-branch"))).toEqual({
      ok: false,
      error: '"no-such-branch" isn\'t a revision in this repository.',
    });
  });
});
