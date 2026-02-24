import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { findGitRoot, readJsonFile, writeJsonFile, cleanDiffprismHooks } from "./setup.js";

interface TeardownFlags {
  global?: boolean;
  quiet?: boolean;
}

interface TeardownResult {
  removed: string[];
  skipped: string[];
}

function teardownMcpJson(gitRoot: string): { action: "removed" | "skipped"; filePath: string } {
  const filePath = path.join(gitRoot, ".mcp.json");

  if (!fs.existsSync(filePath)) {
    return { action: "skipped", filePath };
  }

  const existing = readJsonFile(filePath);
  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;

  if (!servers.diffprism) {
    return { action: "skipped", filePath };
  }

  delete servers.diffprism;

  if (Object.keys(servers).length === 0) {
    // diffprism was the only server — check if there's anything else in the file
    const { mcpServers: _, ...rest } = existing;
    if (Object.keys(rest).length === 0) {
      fs.unlinkSync(filePath);
    } else {
      writeJsonFile(filePath, rest);
    }
  } else {
    writeJsonFile(filePath, { ...existing, mcpServers: servers });
  }

  return { action: "removed", filePath };
}

function teardownClaudePermissions(
  baseDir: string,
): { action: "removed" | "skipped"; filePath: string } {
  const filePath = path.join(baseDir, ".claude", "settings.json");

  if (!fs.existsSync(filePath)) {
    return { action: "skipped", filePath };
  }

  const existing = readJsonFile(filePath);
  const permissions = (existing.permissions ?? {}) as Record<string, unknown>;
  const allow = (permissions.allow ?? []) as string[];

  const toolNames = [
    "mcp__diffprism__open_review",
    "mcp__diffprism__update_review_context",
    "mcp__diffprism__get_review_result",
  ];

  const filtered = allow.filter((t) => !toolNames.includes(t));

  if (filtered.length === allow.length) {
    return { action: "skipped", filePath };
  }

  if (filtered.length > 0) {
    permissions.allow = filtered;
  } else {
    delete permissions.allow;
  }

  if (Object.keys(permissions).length === 0) {
    delete existing.permissions;
  } else {
    existing.permissions = permissions;
  }

  writeJsonFile(filePath, existing);
  return { action: "removed", filePath };
}

function teardownHooks(gitRoot: string): { action: "removed" | "skipped"; filePath: string } {
  const filePath = path.join(gitRoot, ".claude", "settings.json");
  const result = cleanDiffprismHooks(gitRoot);

  if (result.removed > 0) {
    // cleanDiffprismHooks already wrote the file — check if hooks object is now empty
    const existing = readJsonFile(filePath);
    const hooks = existing.hooks as Record<string, unknown> | undefined;
    if (hooks && Object.keys(hooks).length === 0) {
      delete existing.hooks;
      writeJsonFile(filePath, existing);
    }
    return { action: "removed", filePath: filePath + " (hooks)" };
  }

  return { action: "skipped", filePath: filePath + " (hooks)" };
}

function cleanupSettingsFile(baseDir: string): void {
  const filePath = path.join(baseDir, ".claude", "settings.json");

  if (!fs.existsSync(filePath)) return;

  const existing = readJsonFile(filePath);
  if (Object.keys(existing).length === 0) {
    fs.unlinkSync(filePath);
    tryRmdir(path.join(baseDir, ".claude"));
  }
}

function tryRmdir(dirPath: string): void {
  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    // Directory doesn't exist or not empty — ignore
  }
}

function teardownSkill(
  baseDir: string,
  global: boolean,
): { action: "removed" | "skipped"; filePath: string } {
  const skillDir = global
    ? path.join(os.homedir(), ".claude", "skills", "review")
    : path.join(baseDir, ".claude", "skills", "review");
  const filePath = path.join(skillDir, "SKILL.md");

  if (!fs.existsSync(filePath)) {
    return { action: "skipped", filePath };
  }

  fs.unlinkSync(filePath);

  // Clean up empty parent dirs: review/ -> skills/ (stop before .claude/)
  tryRmdir(skillDir);
  tryRmdir(path.dirname(skillDir));

  return { action: "removed", filePath };
}

function teardownGitignore(gitRoot: string): { action: "removed" | "skipped"; filePath: string } {
  const filePath = path.join(gitRoot, ".gitignore");

  if (!fs.existsSync(filePath)) {
    return { action: "skipped", filePath };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const filtered = lines.filter((l) => l.trim() !== ".diffprism");

  if (filtered.length === lines.length) {
    return { action: "skipped", filePath };
  }

  const newContent = filtered.join("\n");

  // If the file is now empty (or just whitespace/newlines), delete it
  if (newContent.trim() === "") {
    fs.unlinkSync(filePath);
  } else {
    fs.writeFileSync(filePath, newContent);
  }

  return { action: "removed", filePath };
}

function teardownDiffprismDir(gitRoot: string): { action: "removed" | "skipped"; filePath: string } {
  const dirPath = path.join(gitRoot, ".diffprism");

  if (!fs.existsSync(dirPath)) {
    return { action: "skipped", filePath: dirPath };
  }

  fs.rmSync(dirPath, { recursive: true });
  return { action: "removed", filePath: dirPath };
}

export async function teardown(flags: TeardownFlags): Promise<TeardownResult> {
  const global = flags.global ?? false;
  const quiet = flags.quiet ?? false;
  const home = os.homedir();

  const result: TeardownResult = { removed: [], skipped: [] };

  if (global) {
    if (!quiet) {
      console.log("Tearing down DiffPrism global configuration...\n");
    }

    const skill = teardownSkill("", true);
    result[skill.action].push(skill.filePath);

    const perms = teardownClaudePermissions(home);
    result[perms.action].push(perms.filePath);

    cleanupSettingsFile(home);

    if (!quiet) {
      printTeardownSummary(result, home);
      console.log("\n✓ DiffPrism global configuration removed.");
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
      "Tip: Use `diffprism teardown --global` to remove global DiffPrism configuration.",
    );
    process.exit(1);
    return { removed: [], skipped: [] };
  }

  if (!quiet) {
    console.log("Tearing down DiffPrism configuration...\n");
  }

  // Step 1: .mcp.json
  const mcp = teardownMcpJson(gitRoot);
  result[mcp.action].push(mcp.filePath);

  // Step 2: Permissions
  const perms = teardownClaudePermissions(gitRoot);
  result[perms.action].push(perms.filePath);

  // Step 3: Hooks
  const hooks = teardownHooks(gitRoot);
  result[hooks.action].push(hooks.filePath);

  // Step 3.5: Clean up empty settings.json
  cleanupSettingsFile(gitRoot);

  // Step 4: Skill file
  const skill = teardownSkill(gitRoot, false);
  result[skill.action].push(skill.filePath);

  // Step 5: .gitignore
  const gitignore = teardownGitignore(gitRoot);
  result[gitignore.action].push(gitignore.filePath);

  // Step 6: .diffprism directory
  const diffprismDir = teardownDiffprismDir(gitRoot);
  result[diffprismDir.action].push(diffprismDir.filePath);

  if (!quiet) {
    printTeardownSummary(result, gitRoot);
    console.log("\n✓ DiffPrism configuration removed.");
  }

  return result;
}

function printTeardownSummary(result: TeardownResult, baseDir: string): void {
  if (result.removed.length > 0) {
    console.log("Removed:");
    for (const f of result.removed) {
      console.log(`  - ${path.relative(baseDir, f) || f}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log("Skipped (not found):");
    for (const f of result.skipped) {
      console.log(`  . ${path.relative(baseDir, f) || f}`);
    }
  }
}
