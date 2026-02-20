import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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

  const toolName = "mcp__diffprism__open_review";

  if (allow.includes(toolName) && !force) {
    return { action: "skipped", filePath };
  }

  if (!allow.includes(toolName)) {
    allow.push(toolName);
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

  // Step 1: .mcp.json
  const mcp = setupMcpJson(gitRoot, force);
  result[mcp.action === "skipped" ? "skipped" : mcp.action === "created" ? "created" : "updated"].push(mcp.filePath);

  // Step 2: .claude/settings.json
  const settings = setupClaudeSettings(gitRoot, force);
  result[settings.action === "skipped" ? "skipped" : settings.action === "created" ? "created" : "updated"].push(settings.filePath);

  // Step 3: Skill file
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
    "If Claude Code is running, restart it to pick up the new configuration.",
  );
}
