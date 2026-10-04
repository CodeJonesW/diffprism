import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installHook } from "../commands/hook.js";
import { runClaudeCli, setupUserMcpServer, stableMcpServer } from "../commands/setup.js";

// ─── DiffPrism in every worktree ───
//
// Real git, with a home and a global git config of the test's own, so the
// machine's real ones are never read or changed. `diffprism` on PATH is a
// stand-in that records being called.
// Real commits run slower when the whole suite runs at once.
vi.setConfig({ testTimeout: 30_000 });

let home: string;
let bin: string;
let repo: string;
let calls: string;

const env = () => ({
  ...process.env,
  HOME: home,
  GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  PATH: `${bin}:${process.env.PATH}`,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
});
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: env(), encoding: "utf8" }).trim();
/** Commit a file; true when the commit lands. */
function commit(cwd: string, file: string): boolean {
  fs.writeFileSync(path.join(cwd, file), "x\n");
  git(cwd, "add", file);
  try {
    git(cwd, "commit", "-qm", file);
    return true;
  } catch {
    return false;
  }
}
const writeConfig = (config: object) => fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify(config));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-setup-home-"));
  bin = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-setup-bin-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-setup-repo-"));
  calls = path.join(home, "calls");
  fs.writeFileSync(path.join(bin, "diffprism"), `#!/bin/sh\necho "$*" >> "${calls}"\nexit 0\n`);
  fs.chmodSync(path.join(bin, "diffprism"), 0o755);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(home, ".gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  git(repo, "init", "-q");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of [home, bin, repo]) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the per-repository commit gate", () => {
  it("gates a commit in every worktree of the repository: they share its hooks", () => {
    vi.spyOn(process, "cwd").mockReturnValue(repo);
    installHook();
    commit(repo, "a.ts");
    const worktree = path.join(home, "wt");
    git(repo, "worktree", "add", "-q", worktree);
    fs.rmSync(calls, { force: true });

    expect(commit(worktree, "b.ts")).toBe(true);
    expect(fs.readFileSync(calls, "utf8").trim()).toBe("hook pre-commit");
  });
});

describe("the MCP server for every project", () => {
  const server = { command: "diffprism", args: ["serve"] };

  it("registers through Claude Code's own CLI, before Claude Code has written its config too", () => {
    const claude = vi.fn();
    expect(setupUserMcpServer({}, server, claude, () => true)).toMatchObject({ action: "created" });
    expect(claude.mock.calls).toEqual([[["mcp", "add-json", "--scope", "user", "diffprism", JSON.stringify({ type: "stdio", ...server })]]]);
  });

  it("has nowhere to go without Claude Code's CLI, on a dry run too", () => {
    const claude = vi.fn();
    expect(setupUserMcpServer({}, server, claude, () => false)).toMatchObject({ action: "unavailable" });
    expect(setupUserMcpServer({ dryRun: true }, server, claude, () => false)).toMatchObject({ action: "unavailable" });
    expect(claude).not.toHaveBeenCalled();
  });

  it("writes nothing on a dry run", () => {
    const claude = vi.fn();
    expect(setupUserMcpServer({ dryRun: true }, server, claude, () => true)).toMatchObject({ action: "created" });
    expect(claude).not.toHaveBeenCalled();
  });

  it("only adds: a registration that's there stays, even with --force", () => {
    const claude = vi.fn();
    // Either command setup writes, on any platform and from whatever PATH it ran with.
    for (const entry of [
      { command: "diffprism", args: ["serve"] },
      { command: "npx", args: ["-y", "diffprism@latest", "serve"] },
      { command: "cmd", args: ["/c", "npx", "-y", "diffprism@latest", "serve"] },
    ]) {
      writeConfig({ mcpServers: { diffprism: entry } });
      expect(setupUserMcpServer({ force: true }, server, claude, () => true)).toEqual({ action: "skipped", filePath: path.join(home, ".claude.json") });
    }
    // One set up on purpose stays too, and says so — as does one that doesn't run the server.
    for (const entry of [{ command: "node", args: ["/dev/diffprism/bin.js", "serve"] }, { command: "npx", args: ["-y", "diffprism@latest", "doctor"] }]) {
      writeConfig({ mcpServers: { diffprism: entry } });
      expect(setupUserMcpServer({}, server, claude, () => true)).toMatchObject({
        action: "skipped",
        note: `keeps your own registration (\`${[entry.command, ...entry.args].join(" ")}\`)`,
      });
    }
    expect(claude).not.toHaveBeenCalled();
  });

  it("reads Claude Code's config from CLAUDE_CONFIG_DIR when that's set", () => {
    const dir = path.join(home, "claude-config");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify({ mcpServers: { diffprism: server } }));
    vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
    const claude = vi.fn();
    expect(setupUserMcpServer({}, server, claude, () => true)).toMatchObject({ action: "skipped" });
    expect(claude).not.toHaveBeenCalled();
  });

  it("says it can't tell, and tries again later, rather than treating an unreadable config as empty", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), '{"mcpServers": {"diffprism": ');
    const claude = vi.fn();
    expect(setupUserMcpServer({}, server, claude, () => true)).toMatchObject({
      action: "failed",
      note: expect.stringContaining("can't tell whether its tools are registered"),
    });
    expect(claude).not.toHaveBeenCalled();
  });

  it("says why when Claude Code won't register it, rather than throwing out of setup", () => {
    const claude = vi.fn(() => {
      throw Object.assign(new Error("failed"), { stderr: Buffer.from("invalid config") });
    });
    expect(setupUserMcpServer({}, server, claude, () => true)).toMatchObject({
      action: "failed",
      note: "Couldn't register DiffPrism's MCP server with Claude Code: invalid config",
    });
  });

  it("is left out of the server's automatic repair, which mustn't rewrite Claude Code's config mid-session", async () => {
    const { setup, isGlobalSetupDone } = await import("../commands/setup.js");
    const plan = await setup({ global: true, dryRun: true, skipMcpServer: true });
    expect(plan.steps.map((s) => s.artifact)).not.toContain("mcp-server");
    // Explicit setup does it.
    expect((await setup({ global: true, dryRun: true })).steps.map((s) => s.artifact)).toContain("mcp-server");
    expect(typeof (await isGlobalSetupDone())).toBe("boolean");
  });

  it("registers a command that outlives whatever ran setup: diffprism from PATH, else the npm release", () => {
    expect(stableMcpServer(() => true, "darwin")).toEqual({ command: "diffprism", args: ["serve"] });
    expect(stableMcpServer(() => false, "linux")).toEqual({ command: "npx", args: ["-y", "diffprism@latest", "serve"] });
  });

  it("wraps it in `cmd /c` on Windows, where both are .cmd shims Claude Code can't start directly", () => {
    expect(stableMcpServer(() => false, "win32")).toEqual({ command: "cmd", args: ["/c", "npx", "-y", "diffprism@latest", "serve"] });
  });

  it("doesn't take npx's temporary diffprism for an installed one, but does take ~/.npm-global's", () => {
    const npxBin = path.join(home, ".npm", "_npx", "abc", "node_modules", ".bin");
    const globalBin = path.join(home, ".npm-global", "bin");
    for (const dir of [npxBin, globalBin]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(npxBin, "diffprism"), "#!/bin/sh\n");
    fs.chmodSync(path.join(npxBin, "diffprism"), 0o755);
    vi.stubEnv("npm_config_cache", path.join(home, ".npm"));
    vi.stubEnv("PATH", npxBin);
    expect(stableMcpServer().args).toContain("diffprism@latest");

    fs.copyFileSync(path.join(npxBin, "diffprism"), path.join(globalBin, "diffprism"));
    fs.chmodSync(path.join(globalBin, "diffprism"), 0o755);
    vi.stubEnv("PATH", `${npxBin}${path.delimiter}${globalBin}`);
    expect(stableMcpServer()).toEqual({ command: "diffprism", args: ["serve"] });
  });

  it("says so when Claude Code's command isn't on PATH, rather than failing setup", () => {
    const missing = () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    };
    expect(setupUserMcpServer({}, server, missing, () => true)).toMatchObject({
      action: "unavailable",
      note: expect.stringContaining("`claude` command isn't on PATH"),
    });
  });

  it("hands Claude Code's CLI each argument intact, JSON and all", () => {
    const argv = path.join(home, "argv");
    fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argv}"; done\n`);
    fs.chmodSync(path.join(bin, "claude"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    const json = JSON.stringify({ type: "stdio", command: "cmd", args: ["/c", "a b", "& \"c\""] });

    runClaudeCli(["mcp", "add-json", "--scope", "user", "diffprism", json]);
    expect(fs.readFileSync(argv, "utf8").trimEnd().split("\n")).toEqual(["mcp", "add-json", "--scope", "user", "diffprism", json]);
  });

  it("throws with Claude Code's own error when its CLI fails", () => {
    fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\necho 'invalid config' >&2\nexit 3\n");
    fs.chmodSync(path.join(bin, "claude"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    expect(() => runClaudeCli(["mcp", "add-json"])).toThrow(expect.objectContaining({ stderr: Buffer.from("invalid config\n") }));
  });
});
