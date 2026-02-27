import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveGitHubToken } from "../auth.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("resolveGitHubToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns GITHUB_TOKEN from environment", () => {
    process.env.GITHUB_TOKEN = "ghp_env_token_123";
    expect(resolveGitHubToken()).toBe("ghp_env_token_123");
  });

  it("falls back to gh auth token", () => {
    vi.mocked(execSync).mockReturnValue("ghp_cli_token_456\n");
    expect(resolveGitHubToken()).toBe("ghp_cli_token_456");
  });

  it("falls back to config file", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("gh not found");
    });

    const configDir = path.join(os.homedir(), ".diffprism");
    const configPath = path.join(configDir, "config.json");

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ github: { token: "ghp_config_token_789" } }),
    );

    expect(resolveGitHubToken()).toBe("ghp_config_token_789");
  });

  it("throws with instructions when no token found", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("gh not found");
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    expect(() => resolveGitHubToken()).toThrow("GitHub token not found");
  });

  it("prefers GITHUB_TOKEN over gh CLI", () => {
    process.env.GITHUB_TOKEN = "ghp_env_first";
    vi.mocked(execSync).mockReturnValue("ghp_cli_second");

    expect(resolveGitHubToken()).toBe("ghp_env_first");
    expect(execSync).not.toHaveBeenCalled();
  });
});
