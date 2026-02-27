import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Resolve a GitHub token from the environment, GitHub CLI, or DiffPrism config.
 *
 * Resolution order:
 * 1. GITHUB_TOKEN environment variable
 * 2. `gh auth token` (GitHub CLI)
 * 3. ~/.diffprism/config.json → github.token
 * 4. Throw with instructions
 */
export function resolveGitHubToken(): string {
  // 1. Environment variable
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. GitHub CLI
  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) {
      return token;
    }
  } catch {
    // gh not installed or not authenticated — continue
  }

  // 3. DiffPrism config file
  const configPath = path.join(os.homedir(), ".diffprism", "config.json");
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const github = config.github as Record<string, unknown> | undefined;
      if (github?.token && typeof github.token === "string") {
        return github.token;
      }
    }
  } catch {
    // Malformed config — continue
  }

  // 4. No token found
  throw new Error(
    `GitHub token not found. Provide one via:\n` +
      `  1. GITHUB_TOKEN environment variable\n` +
      `  2. gh auth login (GitHub CLI)\n` +
      `  3. ~/.diffprism/config.json → { "github": { "token": "..." } }`,
  );
}
