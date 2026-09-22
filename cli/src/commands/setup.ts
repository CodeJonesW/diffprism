import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { skillContent } from "../templates/skill.js";
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
}

/** How a step writes: `force` rewrites what is already there, `dryRun` writes nothing. */
interface WriteMode {
  force?: boolean;
  dryRun?: boolean;
}

export interface SetupOutcome {
  created: string[];
  updated: string[];
  skipped: string[];
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

interface SetupResult {
  created: string[];
  updated: string[];
  skipped: string[];
}

function setupMcpJson(
  gitRoot: string,
  { force, dryRun }: WriteMode,
): { action: "created" | "updated" | "skipped"; filePath: string } {
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

function setupClaudeSettings(
  baseDir: string,
  { force, dryRun }: WriteMode,
): { action: "created" | "updated" | "skipped"; filePath: string } {
  const filePath = path.join(baseDir, ".claude", "settings.json");
  const existing = readJsonFile(filePath);

  const permissions = (existing.permissions ?? {}) as Record<string, unknown>;
  const allow = (permissions.allow ?? []) as string[];

  const toolNames = MCP_TOOL_NAMES.map(mcpToolPermission);
  const retired = new Set<string>(RETIRED_MCP_TOOL_NAMES.map(mcpToolPermission));

  const allPresent = toolNames.every((t) => allow.includes(t));
  const hasRetired = allow.some((t) => retired.has(t));
  if (allPresent && !hasRetired && !force) {
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
): { action: "created" | "updated" | "skipped"; filePath: string } {
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

async function promptUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== "n");
    });
  });
}

async function setupGitignore(
  gitRoot: string,
  { dryRun }: WriteMode,
): Promise<{ action: "created" | "updated" | "skipped"; filePath: string }> {
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

  const confirmed = await promptUser(
    "No .gitignore found. Create one with DiffPrism entries? (Y/n) ",
  );
  if (!confirmed) {
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

  const result: SetupResult = { created: [], updated: [], skipped: [] };
  const home = os.homedir();

  // Global-only mode: no git root required
  if (global) {
    if (!quiet) {
      console.log("Setting up DiffPrism globally...\n");
    }

    // Global skill file
    const skill = setupSkill("", true, mode);
    result[skill.action].push(skill.filePath);

    // Global permissions in ~/.claude/settings.json
    const settings = setupClaudeSettings(home, mode);
    result[settings.action].push(settings.filePath);

    if (!quiet) {
      printSummary(result, home);
      console.log("\n✓ DiffPrism configured globally.\n");
      console.log("Next steps:");
      console.log("  1. Run `diffprism server` to start the global review server");
      console.log("  2. In each project, run `diffprism setup` to register the MCP server");
      console.log("  3. Use /review in Claude Code to review your changes\n");
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
    return { created: [], updated: [], skipped: [] };
  }

  if (!quiet) {
    console.log("Setting up DiffPrism for Claude Code...\n");
  }

  // Step 1: .gitignore
  const gitignore = await setupGitignore(gitRoot, mode);
  result[gitignore.action].push(gitignore.filePath);

  // Step 2: .mcp.json
  const mcp = setupMcpJson(gitRoot, mode);
  result[mcp.action].push(mcp.filePath);

  // Step 3: .claude/settings.json (permissions)
  const settings = setupClaudeSettings(gitRoot, mode);
  result[settings.action].push(settings.filePath);

  // Step 4: Skill file
  const skill = setupSkill(gitRoot, false, mode);
  result[skill.action].push(skill.filePath);

  if (!quiet) {
    console.log("\n✓ DiffPrism configured for Claude Code.\n");
    console.log("Next: Restart Claude Code, then type /review to review your changes.\n");
  }

  return result;
}

function printSummary(result: SetupResult, baseDir: string): void {
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
  const plan = await setup({ global: true, dryRun: true });
  return plan.created.length === 0 && plan.updated.length === 0;
}
