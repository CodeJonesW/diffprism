import { sync as spawnSync } from "cross-spawn";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { skillContent } from "../templates/skill.js";
import type { McpCommand } from "./pr-agent.js";
import { MCP_TOOL_NAMES, RETIRED_MCP_TOOL_NAMES, mcpToolPermission } from "@diffprism/core";

export const GITIGNORE_ENTRIES = [
  ".diffprism",
  ".mcp.json",
  ".claude/settings.json",
  ".claude/skills/review/",
];

interface SetupFlags {
  global?: boolean;
  force?: boolean;
  quiet?: boolean;
  dev?: boolean;
  demo?: boolean;
  /**
   * Work out what setup would write, and write none of it. The outcome names
   * the same files a real run would — which is how `isGlobalSetupDone` asks
   * whether an install is current without keeping its own idea of what
   * current means.
   */
  dryRun?: boolean;
  /**
   * Leave Claude Code's MCP registration alone. The server's automatic
   * repair sets it: a server that starts in the background — the commit
   * gate starts one — mustn't rewrite Claude Code's config mid-session. It's
   * done by `diffprism setup --global` and `doctor --fix`, which someone ran.
   */
  skipMcpServer?: boolean;
}

/** How a step writes: `force` rewrites what is already there, `dryRun` writes nothing. */
interface WriteMode {
  force?: boolean;
  dryRun?: boolean;
}

/** Something setup installs. `mcp-server` is the MCP server registered for every project (Claude Code's user scope). */
export type SetupArtifact = "gitignore" | "mcp-json" | "mcp-server" | "permissions" | "skill";

/** `unavailable`: there's nothing here to install it into (Claude Code isn't set up), and `note` says why. */
export type SetupAction = "created" | "updated" | "skipped" | "unavailable" | "failed";

/** One thing setup wrote, or would write, and where. */
export interface SetupStep {
  artifact: SetupArtifact;
  action: SetupAction;
  filePath: string;
  note?: string;
}

export interface SetupOutcome {
  created: string[];
  updated: string[];
  skipped: string[];
  unavailable: string[];
  failed: string[];
  /** Every step in the order it ran — `doctor` reads each artifact's state here. */
  steps: SetupStep[];
}

export function findGitRoot(from: string): string | null {
  let dir = path.resolve(from);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeJsonFile(
  filePath: string,
  data: Record<string, unknown>,
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

/**
 * DiffPrism commands that earlier versions installed as Claude Code hooks.
 * #139 deleted `notify-stop` together with the code that cleaned up after it,
 * so every project set up before then kept a Stop hook that failed on every
 * turn (#215). Setup and teardown both remove hooks that call one of these.
 */
const RETIRED_HOOK_COMMANDS = ["notify-stop"];

const RETIRED_HOOK = new RegExp(
  `\\bdiffprism(@\\S+)?\\s+(${RETIRED_HOOK_COMMANDS.join("|")})\\b`,
);

interface HookGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

/**
 * `settings` with every hook that calls a retired DiffPrism command removed,
 * or null when it has none. Groups and events left empty go too; everything
 * else — other tools' hooks included — is kept as it was.
 */
export function withoutRetiredHooks(
  settings: Record<string, unknown>,
): Record<string, unknown> | null {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks || typeof hooks !== "object") return null;

  let removed = false;
  const nextHooks: Record<string, unknown> = {};

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      nextHooks[event] = groups;
      continue;
    }
    const nextGroups: HookGroup[] = [];
    for (const group of groups as HookGroup[]) {
      if (!Array.isArray(group?.hooks)) {
        nextGroups.push(group);
        continue;
      }
      const kept = group.hooks.filter(
        (h) => !(typeof h?.command === "string" && RETIRED_HOOK.test(h.command)),
      );
      if (kept.length < group.hooks.length) removed = true;
      if (kept.length > 0) nextGroups.push({ ...group, hooks: kept });
    }
    if (nextGroups.length > 0 || groups.length === 0) {
      nextHooks[event] = nextGroups;
    }
  }

  if (!removed) return null;

  const next = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    next.hooks = nextHooks;
  } else {
    delete next.hooks;
  }
  return next;
}

function setupMcpJson(
  gitRoot: string,
  { force, dryRun }: WriteMode,
): Omit<SetupStep, "artifact"> {
  const filePath = path.join(gitRoot, ".mcp.json");
  const existing = readJsonFile(filePath);

  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;

  if (servers.diffprism && !force) {
    return { action: "skipped", filePath };
  }

  servers.diffprism = {
    command: "npx",
    args: ["diffprism@latest", "serve"],
  };

  const action = fs.existsSync(filePath) ? "updated" : "created";
  if (!dryRun) {
    writeJsonFile(filePath, { ...existing, mcpServers: servers });
  }
  return { action, filePath };
}

/** Runs Claude Code's CLI. Swapped out in tests. Throws when it fails, or isn't installed. */
export type ClaudeCli = (args: string[]) => void;

export const runClaudeCli: ClaudeCli = (args) => {
  // cross-spawn, not `shell: true`: on Windows the npm-installed `claude` is
  // a .cmd shim, and cmd.exe would split and strip add-json's JSON argument.
  // cross-spawn quotes each argument for it, and elsewhere runs it directly.
  const result = spawnSync("claude", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw Object.assign(new Error(`\`claude ${args.slice(0, 2).join(" ")}\` exited with ${result.status ?? result.signal}`), {
      stderr: result.stderr,
    });
  }
};

/**
 * DiffPrism's MCP server, registered for every project — Claude Code's user
 * scope — so every repository and worktree has DiffPrism's tools with nothing
 * per project. A repository's own `.mcp.json` was all there was before, and
 * it's in `.gitignore`, so a new worktree never had it.
 *
 * Read from Claude Code's config to see where it stands; written only through
 * Claude Code's own CLI, never by editing a file Claude Code owns. It only
 * ever adds a registration: one that's there stays, whatever it runs.
 */
export function setupUserMcpServer(
  { dryRun }: WriteMode,
  server: McpCommand = stableMcpServer(),
  claude: ClaudeCli = runClaudeCli,
  claudeInstalled: () => boolean = () => commandOnPath("claude"),
): Omit<SetupStep, "artifact"> {
  // Where Claude Code keeps it: in CLAUDE_CONFIG_DIR when that's set.
  const filePath = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), ".claude.json");
  // Claude Code may not have written its config yet: then nothing's
  // registered, and `claude mcp add-json` creates it. A file that won't parse
  // isn't an empty one, though: Claude Code may be partway through writing
  // it. Read as empty, an existing registration would look missing.
  let config: { mcpServers?: Record<string, { command?: string; args?: string[] }> } = {};
  try {
    if (fs.existsSync(filePath)) config = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    return {
      action: "failed",
      filePath,
      note: `${filePath} couldn't be read (${(err as Error).message}), so DiffPrism can't tell whether its tools are registered. \`diffprism doctor --fix\` tries again.`,
    };
  }
  const current = config.mcpServers?.diffprism;
  // Either command setup writes works wherever it was written from, and
  // anything else (a dev build, a pinned version) was set up on purpose.
  if (current) {
    if (isDiffprismServe(current)) return { action: "skipped", filePath };
    const launches = [current.command, ...(current.args ?? [])].filter(Boolean).join(" ");
    return { action: "skipped", filePath, note: `keeps your own registration (\`${launches}\`)` };
  }
  const unavailable = {
    action: "unavailable" as const,
    filePath,
    note: "Claude Code's `claude` command isn't on PATH, so DiffPrism's tools aren't registered with Claude Code. If you use Claude Code, install it, then run `diffprism setup --global`.",
  };
  // Asked before a dry run answers too, so doctor and `doctor --fix` agree.
  if (!claudeInstalled()) return unavailable;
  if (dryRun) return { action: "created", filePath };
  try {
    claude(["mcp", "add-json", "--scope", "user", "diffprism", JSON.stringify({ type: "stdio", ...server })]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return unavailable;
    const reason = (err as { stderr?: Buffer }).stderr?.toString().trim() || (err as Error).message;
    // A step that says so, not a throw: the steps before it are written, and
    // setup's summary (and doctor) should still say what happened.
    return { action: "failed", filePath, note: `Couldn't register DiffPrism's MCP server with Claude Code: ${reason}` };
  }
  return { action: "created", filePath };
}

/** Whether a registration runs DiffPrism's MCP server the way setup writes it, on any platform. */
function isDiffprismServe(entry: { command?: string; args?: string[] }): boolean {
  const [command, ...args]: string[] =
    entry.command === "cmd" && entry.args?.[0]?.toLowerCase() === "/c" ? entry.args.slice(1) : [entry.command ?? "", ...(entry.args ?? [])];
  if (args.at(-1) !== "serve") return false;
  return command === "diffprism" || (command === "npx" && args.some((a) => /^diffprism(@|$)/.test(a)));
}

/**
 * The command Claude Code runs for DiffPrism in every project: `diffprism`
 * from PATH when it's installed (a dev build that's `npm link`ed is that
 * command too), else the npm release through npx. Never a path to one build's
 * files: a registration for every project outlives whatever ran setup — an
 * npx cache, a worktree, one Node version under nvm — and a path that's gone
 * breaks DiffPrism's tools everywhere. On Windows both are .cmd shims, which
 * Claude Code can start only through `cmd /c`.
 */
export function stableMcpServer(
  onPath: (command: string) => boolean = commandOnPath,
  platform: NodeJS.Platform = process.platform,
): McpCommand {
  const server = onPath("diffprism") ? { command: "diffprism", args: ["serve"] } : { command: "npx", args: ["-y", "diffprism@latest", "serve"] };
  return platform === "win32" ? { command: "cmd", args: ["/c", server.command, ...server.args] } : server;
}

/** Whether running `command` would find it on PATH: an executable file, with Windows' launcher extensions. */
function commandOnPath(command: string): boolean {
  const names =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => command + ext.toLowerCase())
      : [command];
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((dir) => dir !== "" && !isTransientBinDir(dir))
    .some((dir) =>
      names.some((name) => {
        const file = path.join(dir, name);
        try {
          fs.accessSync(file, fs.constants.X_OK);
          return fs.statSync(file).isFile();
        } catch {
          return false;
        }
      }),
    );
}

/**
 * A PATH entry that only this run has: npx and `npm exec`/`npm run` put a
 * package's `node_modules/.bin` (in npm's cache, for npx) first on PATH.
 * Claude Code starts the server later, from its own PATH, where those
 * aren't — a `diffprism` found there would be gone when it's needed.
 */
function isTransientBinDir(dir: string): boolean {
  const cache = process.env.npm_config_cache;
  return (
    dir.split(path.sep).includes("_npx") ||
    dir.endsWith(path.join("node_modules", ".bin")) ||
    // Inside the cache folder, not one that only starts the same (~/.npm-global).
    (cache !== undefined && cache !== "" && (dir === cache || dir.startsWith(path.join(cache, path.sep))))
  );
}

function setupClaudeSettings(
  baseDir: string,
  { force, dryRun }: WriteMode,
): Omit<SetupStep, "artifact"> {
  const filePath = path.join(baseDir, ".claude", "settings.json");
  const read = readJsonFile(filePath);
  // Upgrading also drops hooks an older version installed for commands that
  // no longer exist — they fail on every turn until something removes them.
  const withoutDeadHooks = withoutRetiredHooks(read);
  const existing = withoutDeadHooks ?? read;

  const permissions = (existing.permissions ?? {}) as Record<string, unknown>;
  const allow = (permissions.allow ?? []) as string[];

  const toolNames = MCP_TOOL_NAMES.map(mcpToolPermission);
  const retired = new Set<string>(RETIRED_MCP_TOOL_NAMES.map(mcpToolPermission));

  const allPresent = toolNames.every((t) => allow.includes(t));
  const hasRetired = allow.some((t) => retired.has(t));
  if (allPresent && !hasRetired && !withoutDeadHooks && !force) {
    return { action: "skipped", filePath };
  }

  // Upgrading prunes permissions for tools that no longer exist.
  const next = allow.filter((t) => !retired.has(t));
  for (const toolName of toolNames) {
    if (!next.includes(toolName)) {
      next.push(toolName);
    }
  }

  permissions.allow = next;
  const action = fs.existsSync(filePath) ? "updated" : "created";
  if (!dryRun) {
    writeJsonFile(filePath, { ...existing, permissions });
  }
  return { action, filePath };
}

function setupSkill(
  gitRoot: string,
  global: boolean,
  { dryRun }: WriteMode,
): Omit<SetupStep, "artifact"> {
  const skillDir = global
    ? path.join(os.homedir(), ".claude", "skills", "review")
    : path.join(gitRoot, ".claude", "skills", "review");
  const filePath = path.join(skillDir, "SKILL.md");

  if (fs.existsSync(filePath)) {
    const existingContent = fs.readFileSync(filePath, "utf-8");
    if (existingContent === skillContent) {
      return { action: "skipped", filePath };
    }
    // Always update the skill file — it's managed by DiffPrism, not user-edited
  }

  const action = fs.existsSync(filePath) ? "updated" : "created";
  if (!dryRun) {
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }
    fs.writeFileSync(filePath, skillContent);
  }
  return { action, filePath };
}

/**
 * Asks a yes/no question at the terminal; the default is yes. Closing it
 * without an answer (Ctrl+C, Ctrl+D) cancels setup. It used to wait on a
 * promise nothing resolved, so setup exited 0 having written nothing.
 */
async function promptUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (answered) return;
      console.log("\nSetup cancelled.");
      process.exit(130);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.toLowerCase() !== "n");
    });
  });
}

async function setupGitignore(
  gitRoot: string,
  { dryRun }: WriteMode,
): Promise<Omit<SetupStep, "artifact">> {
  const filePath = path.join(gitRoot, ".gitignore");

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    const missing = GITIGNORE_ENTRIES.filter((e) => !lines.includes(e));
    if (missing.length === 0) {
      return { action: "skipped", filePath };
    }
    const suffix = missing.map((e) => e + "\n").join("");
    const newContent = content.endsWith("\n")
      ? content + suffix
      : content + "\n" + suffix;
    if (!dryRun) {
      fs.writeFileSync(filePath, newContent);
    }
    return { action: "updated", filePath };
  }

  // A dry run reports the file it would offer to create. Asking would turn a
  // question about the install into a prompt the caller never asked for.
  if (dryRun) {
    return { action: "created", filePath };
  }

  // Only a terminal can answer. Without one — an agent's shell, CI — the
  // question would read end-of-input, or wait forever on a pipe that never
  // closes (#291), so take its default and say so.
  if (!process.stdin.isTTY) {
    console.log("No .gitignore found. Creating one with DiffPrism entries.");
  } else if (
    !(await promptUser("No .gitignore found. Create one with DiffPrism entries? (Y/n) "))
  ) {
    console.log(
      "  Warning: DiffPrism files will appear in git status and may be accidentally committed.",
    );
    return { action: "skipped", filePath };
  }

  fs.writeFileSync(filePath, GITIGNORE_ENTRIES.map((e) => e + "\n").join(""));
  return { action: "created", filePath };
}

export async function setup(flags: SetupFlags): Promise<SetupOutcome> {
  const force = flags.force ?? false;
  const global = flags.global ?? false;
  const quiet = flags.quiet ?? false;

  // Interactive wizard for first-time users:
  // - Not --global or --force
  // - TTY stdin (not piped/CI)
  // - Not quiet mode, and not a dry run — it answers a question, it doesn't install
  const isInteractive =
    !global && !force && !quiet && !flags.dryRun && process.stdin.isTTY;

  if (isInteractive) {
    return setupInteractive(flags);
  }

  return setupBatch(flags);
}

async function setupInteractive(flags: SetupFlags): Promise<SetupOutcome> {
  const dev = flags.dev;
  const demo = flags.demo !== false;
  const gitRoot = findGitRoot(process.cwd());

  console.log("\n  Welcome to DiffPrism");
  console.log("  Browser-based code review for agent-generated changes.\n");

  let outcome: SetupOutcome;

  if (!gitRoot) {
    outcome = await setupBatch({ global: true, quiet: true });
    // Quiet hides the summary, so say here when the tools didn't register.
    const mcp = outcome.steps.find((s) => s.artifact === "mcp-server");
    if (mcp && !isRegistered(mcp)) {
      console.log(`  ! The /review skill and permissions are set up. DiffPrism's MCP server: ${mcp.note}\n`);
      if (demo) await runDemo(dev);
      return outcome;
    }
    console.log("  ✓ Configured for Claude Code (global).");
  } else {
    outcome = await setupBatch({ quiet: true });
    if (outcome.created.length > 0 || outcome.updated.length > 0) {
      console.log("  ✓ Configured for Claude Code.");
    } else {
      console.log("  ✓ Already configured.");
    }
  }

  console.log("  Restart Claude Code, then type /review to start a review.\n");

  if (demo) {
    await runDemo(dev);
  }

  return outcome;
}

async function runDemo(dev?: boolean): Promise<void> {
  console.log("");
  const { demo } = await import("./demo.js");
  await demo({ dev });
}

async function setupBatch(flags: SetupFlags): Promise<SetupOutcome> {
  const force = flags.force ?? false;
  const global = flags.global ?? false;
  const dryRun = flags.dryRun ?? false;
  // A dry run is a question, and a question shouldn't announce an install.
  const quiet = (flags.quiet ?? false) || dryRun;
  const mode: WriteMode = { force, dryRun };

  const result: SetupOutcome = { created: [], updated: [], skipped: [], unavailable: [], failed: [], steps: [] };
  const record = (artifact: SetupArtifact, step: Omit<SetupStep, "artifact">) => {
    result[step.action].push(step.filePath);
    result.steps.push({ artifact, ...step });
  };
  const home = os.homedir();

  // Global-only mode: no git root required
  if (global) {
    if (!quiet) {
      console.log("Setting up DiffPrism globally...\n");
    }

    // Global skill file
    record("skill", setupSkill("", true, mode));

    // Global permissions in ~/.claude/settings.json
    record("permissions", setupClaudeSettings(home, mode));

    // The MCP server, for every project and worktree
    if (!flags.skipMcpServer) record("mcp-server", setupUserMcpServer(mode));

    if (!quiet) {
      printSummary(result, home);
      // Says what's true: the tools are there only if the server registered.
      const mcp = result.steps.find((s) => s.artifact === "mcp-server");
      if (!mcp) {
        // Left to `diffprism setup --global` (the server's repair skips it).
        console.log("\n✓ The /review skill and permissions are up to date.\n");
      } else if (isRegistered(mcp)) {
        console.log("\n✓ DiffPrism configured globally.\n");
        console.log("Next steps:");
        console.log("  1. Restart Claude Code: every project and worktree now has DiffPrism's tools and /review");
        console.log("  2. Optional: in a repository, `diffprism hook install` gates large commits on a review, in the worktrees that share its hooks\n");
      } else {
        // The note above says why: not registered, or (an unreadable config) can't tell.
        console.log("\n! The /review skill and permissions are set up. See above about DiffPrism's MCP server.\n");
      }
    }

    return result;
  }

  // Per-project mode: requires git root
  const gitRoot = findGitRoot(process.cwd());
  if (!gitRoot) {
    console.error(
      "Error: Not in a git repository. Run this command from inside a git project.",
    );
    console.error(
      "Tip: Use `diffprism setup --global` to configure DiffPrism globally without a git repo.",
    );
    process.exit(1);
    return { created: [], updated: [], skipped: [], unavailable: [], failed: [], steps: [] };
  }

  if (!quiet) {
    console.log("Setting up DiffPrism for Claude Code...\n");
  }

  // Step 1: .gitignore
  record("gitignore", await setupGitignore(gitRoot, mode));

  // Step 2: .mcp.json
  record("mcp-json", setupMcpJson(gitRoot, mode));

  // Step 3: .claude/settings.json (permissions)
  record("permissions", setupClaudeSettings(gitRoot, mode));

  // Step 4: Skill file
  record("skill", setupSkill(gitRoot, false, mode));

  if (!quiet) {
    console.log("\n✓ DiffPrism configured for Claude Code.\n");
    console.log("Next: Restart Claude Code, then type /review to review your changes.\n");
  }

  return result;
}

/** Whether the MCP server step left DiffPrism's tools registered with Claude Code. */
function isRegistered(step: SetupStep): boolean {
  return step.action === "created" || step.action === "skipped";
}

function printSummary(result: SetupOutcome, baseDir: string): void {
  if (result.created.length > 0) {
    console.log("Created:");
    for (const f of result.created) {
      console.log(`  + ${path.relative(baseDir, f) || f}`);
    }
  }

  if (result.updated.length > 0) {
    console.log("Updated:");
    for (const f of result.updated) {
      console.log(`  ~ ${path.relative(baseDir, f) || f}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log("Skipped (already configured):");
    for (const f of result.skipped) {
      console.log(`  - ${path.relative(baseDir, f) || f}`);
    }
  }

  for (const step of result.steps.filter((s) => s.action === "unavailable" || s.action === "failed")) {
    console.log(`Not set up: ${step.note}`);
  }
  for (const step of result.steps.filter((s) => s.action === "skipped" && s.note)) {
    console.log(`Kept: ${step.note}`);
  }
}

/**
 * Whether the global install matches this version of DiffPrism — the skill
 * this build ships and permissions for the tools it registers. `diffprism
 * server` asks before starting, so an upgrade repairs what an older one wrote.
 *
 * It is the installer's own answer: a dry run reports what setup would write,
 * and nothing to write means nothing is out of date. Keep it that way. The
 * check this replaced kept its own list of expected tool names and looked only
 * for the skill file's existence, so it went on answering "done" while the
 * tools were renamed around it and the installed skill aged six months (#211).
 */
export async function isGlobalSetupDone(): Promise<boolean> {
  // The server asks this to repair what it can by itself: the skill and
  // permissions, not Claude Code's MCP registration (see skipMcpServer).
  const plan = await setup({ global: true, dryRun: true, skipMcpServer: true });
  return plan.created.length === 0 && plan.updated.length === 0;
}
