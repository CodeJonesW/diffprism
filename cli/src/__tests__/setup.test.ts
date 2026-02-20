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

import { setup } from "../commands/setup.js";

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
    it("errors when not in a git repo", async () => {
      mockExistsSync.mockReturnValue(false);

      await setup({});

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Not in a git repository"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
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
    it("creates .claude/settings.json with permission", async () => {
      await setup({});

      const settingsCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("settings.json"),
      );
      expect(settingsCall).toBeDefined();

      const written = JSON.parse(settingsCall![1] as string);
      expect(written.permissions.allow).toContain(
        "mcp__diffprism__open_review",
      );
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
              allow: ["mcp__diffprism__open_review"],
            },
          });
        }
        throw new Error("File not found");
      });

      await setup({});

      // Should be skipped since it already exists
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Skipped"),
      );
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
        expect.stringContaining("restart"),
      );
    });
  });
});
