import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { skillContent } from "../templates/skill.js";

interface SetupFlags {
  global?: boolean;
  force?: boolean;
}

function findGitRoot(from: string): string | null {
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

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJsonFile(
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
  force: boolean,
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
  writeJsonFile(filePath, { ...existing, mcpServers: servers });
  return { action, filePath };
}

function setupClaudeSettings(
  gitRoot: string,
  force: boolean,
): { action: "created" | "updated" | "skipped"; filePath: string } {
  const filePath = path.join(gitRoot, ".claude", "settings.json");
  const existing = readJsonFile(filePath);

  const permissions = (existing.permissions ?? {}) as Record<string, unknown>;
  const allow = (permissions.allow ?? []) as string[];

  const toolNames = [
    "mcp__diffprism__open_review",
    "mcp__diffprism__update_review_context",
    "mcp__diffprism__get_review_result",
  ];

  const allPresent = toolNames.every((t) => allow.includes(t));
  if (allPresent && !force) {
    return { action: "skipped", filePath };
  }

  for (const toolName of toolNames) {
    if (!allow.includes(toolName)) {
      allow.push(toolName);
    }
  }

  permissions.allow = allow;
  const action = fs.existsSync(filePath) ? "updated" : "created";
  writeJsonFile(filePath, { ...existing, permissions });
  return { action, filePath };
}

function setupSkill(
  gitRoot: string,
  global: boolean,
  force: boolean,
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
    if (!force) {
      console.log(
        `  Warning: ${filePath} exists with different content. Use --force to overwrite.`,
      );
      return { action: "skipped", filePath };
    }
  }

  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  const action = fs.existsSync(filePath) ? "updated" : "created";
  fs.writeFileSync(filePath, skillContent);
  return { action, filePath };
}

export function cleanDiffprismHooks(
  gitRoot: string,
): { removed: number } {
  const filePath = path.join(gitRoot, ".claude", "settings.json");
  const existing = readJsonFile(filePath);

  const hooks = existing.hooks as Record<string, unknown> | undefined;
  if (!hooks) return { removed: 0 };

  const stopHooks = hooks.Stop;
  if (!Array.isArray(stopHooks) || stopHooks.length === 0) {
    return { removed: 0 };
  }

  const filtered = stopHooks.filter((entry: Record<string, unknown>) => {
    const innerHooks = entry.hooks;
    if (!Array.isArray(innerHooks)) return true;
    return !innerHooks.some((h: Record<string, unknown>) => {
      const cmd = h.command;
      return (
        typeof cmd === "string" &&
        cmd.includes("diffprism") &&
        cmd.includes("notify-stop")
      );
    });
  });

  const removed = stopHooks.length - filtered.length;

  if (removed > 0) {
    if (filtered.length > 0) {
      hooks.Stop = filtered;
    } else {
      delete hooks.Stop;
    }
    writeJsonFile(filePath, { ...existing, hooks });
  }

  return { removed };
}

function setupStopHook(
  gitRoot: string,
  force: boolean,
): { action: "created" | "updated" | "skipped"; filePath: string } {
  const filePath = path.join(gitRoot, ".claude", "settings.json");
  const existing = readJsonFile(filePath);

  const hooks = (existing.hooks ?? {}) as Record<string, unknown>;
  const stopHooks = hooks.Stop as Array<Record<string, unknown>> | undefined;

  const hookCommand = "npx diffprism@latest notify-stop";

  // Check if hook already exists
  if (stopHooks && !force) {
    const hasHook = stopHooks.some((entry) => {
      const innerHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
      return innerHooks?.some((h) => h.command === hookCommand);
    });
    if (hasHook) {
      return { action: "skipped", filePath };
    }
  }

  const hookEntry = {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: hookCommand,
      },
    ],
  };

  if (stopHooks && !force) {
    stopHooks.push(hookEntry);
  } else {
    hooks.Stop = [hookEntry];
  }

  const action = fs.existsSync(filePath) ? "updated" : "created";
  writeJsonFile(filePath, { ...existing, hooks });
  return { action, filePath: filePath + " (Stop hook)" };
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
): Promise<{ action: "created" | "updated" | "skipped"; filePath: string }> {
  const filePath = path.join(gitRoot, ".gitignore");
  const entry = ".diffprism";

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    if (lines.includes(entry)) {
      return { action: "skipped", filePath };
    }
    const newContent = content.endsWith("\n")
      ? content + entry + "\n"
      : content + "\n" + entry + "\n";
    fs.writeFileSync(filePath, newContent);
    return { action: "updated", filePath };
  }

  const confirmed = await promptUser(
    "No .gitignore found. Create one with .diffprism entry? (Y/n) ",
  );
  if (!confirmed) {
    console.log(
      "  Warning: .diffprism directory will appear in git status and may trigger watch-mode loops.",
    );
    return { action: "skipped", filePath };
  }

  fs.writeFileSync(filePath, entry + "\n");
  return { action: "created", filePath };
}

export async function setup(flags: SetupFlags): Promise<void> {
  const gitRoot = findGitRoot(process.cwd());
  if (!gitRoot) {
    console.error(
      "Error: Not in a git repository. Run this command from inside a git project.",
    );
    process.exit(1);
    return;
  }

  const force = flags.force ?? false;
  const global = flags.global ?? false;

  console.log("Setting up DiffPrism for Claude Code...\n");

  const result: SetupResult = { created: [], updated: [], skipped: [] };

  // Step 1: .gitignore
  const gitignore = await setupGitignore(gitRoot);
  result[gitignore.action].push(gitignore.filePath);

  // Step 2: .mcp.json
  const mcp = setupMcpJson(gitRoot, force);
  result[mcp.action === "skipped" ? "skipped" : mcp.action === "created" ? "created" : "updated"].push(mcp.filePath);

  // Step 3: .claude/settings.json (permissions)
  const settings = setupClaudeSettings(gitRoot, force);
  result[settings.action === "skipped" ? "skipped" : settings.action === "created" ? "created" : "updated"].push(settings.filePath);

  // Step 3.5: Clean stale diffprism hooks before adding current one
  const cleaned = cleanDiffprismHooks(gitRoot);
  if (cleaned.removed > 0) {
    console.log(`  Cleaned ${cleaned.removed} stale hook(s)`);
  }

  // Step 4: .claude/settings.json (Stop hook for watch mode)
  const hook = setupStopHook(gitRoot, force);
  result[hook.action === "skipped" ? "skipped" : hook.action === "created" ? "created" : "updated"].push(hook.filePath);

  // Step 5: Skill file
  const skill = setupSkill(gitRoot, global, force);
  result[skill.action === "skipped" ? "skipped" : skill.action === "created" ? "created" : "updated"].push(skill.filePath);

  // Print summary
  if (result.created.length > 0) {
    console.log("Created:");
    for (const f of result.created) {
      console.log(`  + ${path.relative(gitRoot, f)}`);
    }
  }

  if (result.updated.length > 0) {
    console.log("Updated:");
    for (const f of result.updated) {
      console.log(`  ~ ${path.relative(gitRoot, f)}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log("Skipped (already configured):");
    for (const f of result.skipped) {
      console.log(`  - ${path.relative(gitRoot, f)}`);
    }
  }

  console.log(
    '\nYou can now use /review in Claude Code to open a DiffPrism review.',
  );
  console.log(
    "Or run `diffprism watch --staged` for live-updating reviews.",
  );
  console.log(
    "If Claude Code is running, restart it to pick up the new configuration.",
  );
}
