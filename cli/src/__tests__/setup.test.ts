import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { skillContent } from "../templates/skill.js";

// Mock node:fs
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

// Mock node:os for homedir
vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(() => "/home/testuser"),
  },
}));

// Mock node:readline
const mockQuestion = vi.fn();
const mockClose = vi.fn();
vi.mock("node:readline", () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: mockQuestion,
      close: mockClose,
    })),
  },
}));

import { setup, cleanDiffprismHooks, isGlobalSetupDone, GITIGNORE_ENTRIES } from "../commands/setup.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

describe("setup command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue("/projects/myapp");

    // Default: readline prompt auto-confirms
    mockQuestion.mockImplementation((_q: string, cb: (answer: string) => void) => cb("Y"));

    // Default: .git exists at /projects/myapp
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s === path.join("/projects/myapp", ".git")) return true;
      return false;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("git root detection", () => {
    it("errors when not in a git repo (non-global)", async () => {
      mockExistsSync.mockReturnValue(false);

      await setup({});

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Not in a git repository"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("suggests --global when not in a git repo", async () => {
      mockExistsSync.mockReturnValue(false);

      await setup({});

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("--global"),
      );
    });

    it("finds git root in parent directory", async () => {
      vi.mocked(process.cwd).mockReturnValue("/projects/myapp/src/deep");
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        return false;
      });

      await setup({});

      // Should have written .mcp.json at the git root
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        path.join("/projects/myapp", ".mcp.json"),
        expect.any(String),
      );
    });
  });

  describe(".gitignore", () => {
    it("creates .gitignore with all DiffPrism entries when user confirms", async () => {
      mockQuestion.mockImplementation((_q: string, cb: (answer: string) => void) => cb("Y"));

      await setup({});

      const gitignoreCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".gitignore"),
      );
      expect(gitignoreCall).toBeDefined();
      const content = gitignoreCall![1] as string;
      for (const entry of GITIGNORE_ENTRIES) {
        expect(content).toContain(entry + "\n");
      }
    });

    it("appends missing entries to existing .gitignore", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".gitignore")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".gitignore")) return "node_modules\n";
        throw new Error("File not found");
      });

      await setup({});

      const gitignoreCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".gitignore"),
      );
      expect(gitignoreCall).toBeDefined();
      const content = gitignoreCall![1] as string;
      expect(content.startsWith("node_modules\n")).toBe(true);
      for (const entry of GITIGNORE_ENTRIES) {
        expect(content).toContain(entry + "\n");
      }
    });

    it("appends only missing entries when some already present", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".gitignore")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".gitignore")) return "node_modules\n.diffprism\n.mcp.json\n";
        throw new Error("File not found");
      });

      await setup({});

      const gitignoreCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".gitignore"),
      );
      expect(gitignoreCall).toBeDefined();
      const content = gitignoreCall![1] as string;
      // Should NOT duplicate existing entries
      expect(content.match(/\.diffprism/g)!.length).toBe(1);
      expect(content.match(/\.mcp\.json/g)!.length).toBe(1);
      // Should add missing entries
      expect(content).toContain(".claude/settings.json\n");
      expect(content).toContain(".claude/skills/review/\n");
    });

    it("skips when all DiffPrism entries already in .gitignore", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".gitignore")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".gitignore")) {
          return "node_modules\n" + GITIGNORE_ENTRIES.join("\n") + "\n";
        }
        throw new Error("File not found");
      });

      await setup({});

      const gitignoreCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".gitignore"),
      );
      expect(gitignoreCall).toBeUndefined();
    });

    it("skips creation when user declines prompt", async () => {
      mockQuestion.mockImplementation((_q: string, cb: (answer: string) => void) => cb("n"));

      await setup({});

      const gitignoreCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".gitignore"),
      );
      expect(gitignoreCall).toBeUndefined();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Warning"),
      );
    });
  });

  describe(".mcp.json", () => {
    it("creates .mcp.json with diffprism server config", async () => {
      await setup({});

      const mcpCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".mcp.json"),
      );
      expect(mcpCall).toBeDefined();

      const written = JSON.parse(mcpCall![1] as string);
      expect(written.mcpServers.diffprism).toEqual({
        command: "npx",
        args: ["diffprism@latest", "serve"],
      });
    });

    it("preserves existing mcp servers when merging", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".mcp.json")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".mcp.json")) {
          return JSON.stringify({
            mcpServers: {
              other: { command: "other-tool", args: ["serve"] },
            },
          });
        }
        throw new Error("File not found");
      });

      await setup({ force: true });

      const mcpCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".mcp.json"),
      );
      const written = JSON.parse(mcpCall![1] as string);

      expect(written.mcpServers.other).toEqual({
        command: "other-tool",
        args: ["serve"],
      });
      expect(written.mcpServers.diffprism).toEqual({
        command: "npx",
        args: ["diffprism@latest", "serve"],
      });
    });

    it("skips .mcp.json when diffprism already configured", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".mcp.json")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".mcp.json")) {
          return JSON.stringify({
            mcpServers: {
              diffprism: { command: "npx", args: ["diffprism@latest", "serve"] },
            },
          });
        }
        throw new Error("File not found");
      });

      await setup({});

      // Should report as skipped
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Skipped"),
      );
    });
  });

  describe(".claude/settings.json", () => {
    it("creates .claude/settings.json with permissions and hook", async () => {
      await setup({});

      const settingsCalls = mockWriteFileSync.mock.calls.filter(
        (call) => call[0].toString().includes("settings.json"),
      );
      expect(settingsCalls.length).toBeGreaterThan(0);

      // Check permissions write
      const permissionsWrite = settingsCalls.find((call) => {
        const written = JSON.parse(call[1] as string);
        return written.permissions !== undefined;
      });
      expect(permissionsWrite).toBeDefined();
      const permData = JSON.parse(permissionsWrite![1] as string);
      expect(permData.permissions.allow).toContain("mcp__diffprism__open_review");
      expect(permData.permissions.allow).toContain("mcp__diffprism__update_review_context");

      // Check hook write
      const hookWrite = settingsCalls.find((call) => {
        const written = JSON.parse(call[1] as string);
        return written.hooks !== undefined;
      });
      expect(hookWrite).toBeDefined();
      const hookData = JSON.parse(hookWrite![1] as string);
      expect(hookData.hooks.Stop[0].hooks[0].command).toBe("npx diffprism@latest notify-stop");
    });

    it("preserves existing permissions", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s.includes("settings.json")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            permissions: {
              allow: ["some_other_tool"],
            },
          });
        }
        throw new Error("File not found");
      });

      await setup({ force: true });

      const settingsCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("settings.json"),
      );
      const written = JSON.parse(settingsCall![1] as string);

      expect(written.permissions.allow).toContain("some_other_tool");
      expect(written.permissions.allow).toContain(
        "mcp__diffprism__open_review",
      );
    });

    it("does not duplicate permission entry", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s.includes("settings.json")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            permissions: {
              allow: [
                "mcp__diffprism__open_review",
                "mcp__diffprism__update_review_context",
                "mcp__diffprism__get_review_result",
              ],
            },
            hooks: {
              Stop: [{
                matcher: "",
                hooks: [{ type: "command", command: "npx diffprism@latest notify-stop" }],
              }],
            },
          });
        }
        throw new Error("File not found");
      });

      await setup({});

      // Permissions should be skipped; cleanup removes the hook for re-adding
      const settingsWrites = mockWriteFileSync.mock.calls.filter(
        (call) => call[0].toString().includes("settings.json"),
      );
      // Only the cleanup write (removing stale hook) should occur
      expect(settingsWrites).toHaveLength(1);
      const written = JSON.parse(settingsWrites[0][1] as string);
      expect(written.hooks.Stop).toBeUndefined();
      // Permissions preserved unchanged (not duplicated)
      expect(written.permissions.allow).toEqual([
        "mcp__diffprism__open_review",
        "mcp__diffprism__update_review_context",
        "mcp__diffprism__get_review_result",
      ]);
    });
  });

  describe("skill file", () => {
    it("creates skill file at project-level by default", async () => {
      await setup({});

      const skillCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("SKILL.md"),
      );
      expect(skillCall).toBeDefined();
      expect(skillCall![0].toString()).toBe(
        path.join("/projects/myapp", ".claude", "skills", "review", "SKILL.md"),
      );
      expect(skillCall![1]).toBe(skillContent);
    });

    it("creates skill file globally with --global flag", async () => {
      await setup({ global: true });

      const skillCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("SKILL.md"),
      );
      expect(skillCall).toBeDefined();
      expect(skillCall![0].toString()).toBe(
        path.join("/home/testuser", ".claude", "skills", "review", "SKILL.md"),
      );
    });

    it("skips skill file when identical content exists", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s.includes("SKILL.md")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("SKILL.md")) return skillContent;
        throw new Error("File not found");
      });

      await setup({});

      const skillCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("SKILL.md"),
      );
      expect(skillCall).toBeUndefined();
    });

    it("warns when skill content differs without --force", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s.includes("SKILL.md")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("SKILL.md")) return "old skill content";
        throw new Error("File not found");
      });

      await setup({});

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Warning"),
      );
    });

    it("overwrites skill content with --force", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s.includes("SKILL.md")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("SKILL.md")) return "old skill content";
        throw new Error("File not found");
      });

      await setup({ force: true });

      const skillCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("SKILL.md"),
      );
      expect(skillCall).toBeDefined();
      expect(skillCall![1]).toBe(skillContent);
    });
  });

  describe("cleanDiffprismHooks", () => {
    it("removes old-format hook without @latest", () => {
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            permissions: { allow: ["some_tool"] },
            hooks: {
              Stop: [{
                matcher: "",
                hooks: [{ type: "command", command: "npx diffprism notify-stop" }],
              }],
            },
          });
        }
        throw new Error("File not found");
      });

      const result = cleanDiffprismHooks("/projects/myapp");

      expect(result.removed).toBe(1);
      const settingsWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("settings.json"),
      );
      expect(settingsWrite).toBeDefined();
      const written = JSON.parse(settingsWrite![1] as string);
      expect(written.hooks.Stop).toBeUndefined();
      expect(written.permissions.allow).toContain("some_tool");
    });

    it("removes duplicate current-format hooks", () => {
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            hooks: {
              Stop: [
                {
                  matcher: "",
                  hooks: [{ type: "command", command: "npx diffprism@latest notify-stop" }],
                },
                {
                  matcher: "",
                  hooks: [{ type: "command", command: "npx diffprism@latest notify-stop" }],
                },
              ],
            },
          });
        }
        throw new Error("File not found");
      });

      const result = cleanDiffprismHooks("/projects/myapp");

      expect(result.removed).toBe(2);
      const settingsWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("settings.json"),
      );
      const written = JSON.parse(settingsWrite![1] as string);
      expect(written.hooks.Stop).toBeUndefined();
    });

    it("preserves non-diffprism Stop hooks", () => {
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            hooks: {
              Stop: [
                {
                  matcher: "",
                  hooks: [{ type: "command", command: "npx diffprism notify-stop" }],
                },
                {
                  matcher: "",
                  hooks: [{ type: "command", command: "echo cleanup done" }],
                },
              ],
            },
          });
        }
        throw new Error("File not found");
      });

      const result = cleanDiffprismHooks("/projects/myapp");

      expect(result.removed).toBe(1);
      const settingsWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("settings.json"),
      );
      const written = JSON.parse(settingsWrite![1] as string);
      expect(written.hooks.Stop).toHaveLength(1);
      expect(written.hooks.Stop[0].hooks[0].command).toBe("echo cleanup done");
    });

    it("no-op when no hooks exist", () => {
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({ permissions: { allow: [] } });
        }
        throw new Error("File not found");
      });

      const result = cleanDiffprismHooks("/projects/myapp");

      expect(result.removed).toBe(0);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("no-op when no Stop hooks exist", () => {
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            hooks: { PreToolUse: [{ matcher: "", hooks: [] }] },
          });
        }
        throw new Error("File not found");
      });

      const result = cleanDiffprismHooks("/projects/myapp");

      expect(result.removed).toBe(0);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe("summary output", () => {
    it("prints setup complete message", async () => {
      await setup({});

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("/review"),
      );
    });

    it("prints restart reminder", async () => {
      await setup({});

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Restart Claude Code"),
      );
    });
  });

  describe("global setup (--global)", () => {
    it("does not require a git root", async () => {
      mockExistsSync.mockReturnValue(false);

      await setup({ global: true });

      // Should NOT error about git repo
      expect(process.exit).not.toHaveBeenCalled();
    });

    it("installs skill globally and sets global permissions", async () => {
      await setup({ global: true });

      // Check skill file at global location
      const skillCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("SKILL.md"),
      );
      expect(skillCall).toBeDefined();
      expect(skillCall![0].toString()).toBe(
        path.join("/home/testuser", ".claude", "skills", "review", "SKILL.md"),
      );

      // Check global permissions at ~/.claude/settings.json
      const settingsCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString() === path.join("/home/testuser", ".claude", "settings.json"),
      );
      expect(settingsCall).toBeDefined();
      const written = JSON.parse(settingsCall![1] as string);
      expect(written.permissions.allow).toContain("mcp__diffprism__open_review");
      expect(written.permissions.allow).toContain("mcp__diffprism__update_review_context");
      expect(written.permissions.allow).toContain("mcp__diffprism__get_review_result");
    });

    it("does not create .mcp.json, .gitignore, or hooks", async () => {
      await setup({ global: true });

      const mcpCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".mcp.json"),
      );
      expect(mcpCall).toBeUndefined();

      const gitignoreCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".gitignore"),
      );
      expect(gitignoreCall).toBeUndefined();

      // No hooks should be written
      const hookCall = mockWriteFileSync.mock.calls.find((call) => {
        try {
          const written = JSON.parse(call[1] as string);
          return written.hooks !== undefined;
        } catch { return false; }
      });
      expect(hookCall).toBeUndefined();
    });

    it("prints global-specific instructions", async () => {
      await setup({ global: true });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("globally"),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("diffprism server"),
      );
    });
  });

  describe("isGlobalSetupDone", () => {
    it("returns false when skill file is missing", () => {
      mockExistsSync.mockReturnValue(false);

      expect(isGlobalSetupDone()).toBe(false);
    });

    it("returns false when permissions are missing", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s.includes("SKILL.md")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });

      expect(isGlobalSetupDone()).toBe(false);
    });

    it("returns true when skill and all permissions exist", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s.includes("SKILL.md")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            permissions: {
              allow: [
                "mcp__diffprism__open_review",
                "mcp__diffprism__update_review_context",
                "mcp__diffprism__get_review_result",
              ],
            },
          });
        }
        throw new Error("File not found");
      });

      expect(isGlobalSetupDone()).toBe(true);
    });

    it("returns false when only some permissions exist", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s.includes("SKILL.md")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          return JSON.stringify({
            permissions: {
              allow: ["mcp__diffprism__open_review"],
            },
          });
        }
        throw new Error("File not found");
      });

      expect(isGlobalSetupDone()).toBe(false);
    });
  });
});
