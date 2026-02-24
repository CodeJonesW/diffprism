import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock node:fs
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    rmdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  },
}));

// Mock node:os for homedir
vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(() => "/home/testuser"),
  },
}));

// Mock node:readline (required by setup.ts import chain)
vi.mock("node:readline", () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: vi.fn(),
      close: vi.fn(),
    })),
  },
}));

import { teardown } from "../commands/teardown.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);
const mockRmSync = vi.mocked(fs.rmSync);
const mockRmdirSync = vi.mocked(fs.rmdirSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

describe("teardown command", () => {
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

    // Default: readdirSync returns empty for cleanup checks
    mockReaddirSync.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("git root detection", () => {
    it("errors when not in a git repo (non-global)", async () => {
      mockExistsSync.mockReturnValue(false);

      await teardown({});

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Not in a git repository"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("suggests --global when not in a git repo", async () => {
      mockExistsSync.mockReturnValue(false);

      await teardown({});

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("--global"),
      );
    });
  });

  describe(".mcp.json removal", () => {
    it("removes diffprism server and keeps others", async () => {
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
              other: { command: "other-tool", args: ["serve"] },
            },
          });
        }
        throw new Error("File not found");
      });

      await teardown({ quiet: true });

      const mcpWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".mcp.json"),
      );
      expect(mcpWrite).toBeDefined();
      const written = JSON.parse(mcpWrite![1] as string);
      expect(written.mcpServers.diffprism).toBeUndefined();
      expect(written.mcpServers.other).toEqual({
        command: "other-tool",
        args: ["serve"],
      });
    });

    it("deletes .mcp.json when diffprism is the only server", async () => {
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

      await teardown({ quiet: true });

      expect(mockUnlinkSync).toHaveBeenCalledWith(
        path.join("/projects/myapp", ".mcp.json"),
      );
    });

    it("skips when .mcp.json does not exist", async () => {
      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining(".mcp.json"),
      );
    });

    it("skips when diffprism not in .mcp.json", async () => {
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

      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining(".mcp.json"),
      );
      // Should not have written or deleted .mcp.json
      const mcpWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".mcp.json"),
      );
      expect(mcpWrite).toBeUndefined();
    });
  });

  describe("permissions removal", () => {
    it("removes diffprism permissions and keeps others", async () => {
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
                "some_other_tool",
                "mcp__diffprism__open_review",
                "mcp__diffprism__update_review_context",
                "mcp__diffprism__get_review_result",
              ],
            },
          });
        }
        throw new Error("File not found");
      });

      await teardown({ quiet: true });

      const settingsWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("settings.json") &&
          !call[0].toString().includes("(hooks)"),
      );
      expect(settingsWrite).toBeDefined();
      const written = JSON.parse(settingsWrite![1] as string);
      expect(written.permissions.allow).toEqual(["some_other_tool"]);
      expect(written.permissions.allow).not.toContain("mcp__diffprism__open_review");
    });

    it("removes permissions object when all diffprism entries removed", async () => {
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
          });
        }
        throw new Error("File not found");
      });

      await teardown({ quiet: true });

      const settingsWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().includes("settings.json") &&
          !call[0].toString().includes("(hooks)"),
      );
      expect(settingsWrite).toBeDefined();
      const written = JSON.parse(settingsWrite![1] as string);
      expect(written.permissions).toBeUndefined();
    });

    it("skips when no diffprism permissions exist", async () => {
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
            permissions: { allow: ["some_other_tool"] },
          });
        }
        throw new Error("File not found");
      });

      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining("settings.json"),
      );
    });
  });

  describe("hook removal", () => {
    it("removes diffprism hooks via cleanDiffprismHooks", async () => {
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

      const result = await teardown({ quiet: true });

      expect(result.removed).toContainEqual(
        expect.stringContaining("hooks"),
      );
    });

    it("skips when no hooks exist", async () => {
      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining("hooks"),
      );
    });
  });

  describe("settings.json cleanup", () => {
    it("deletes settings.json when empty after removals", async () => {
      // Track state changes as functions are called
      let settingsContent = JSON.stringify({
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

      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s.includes("settings.json")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.includes("settings.json")) return settingsContent;
        throw new Error("File not found");
      });

      // Track writes to settings.json so subsequent reads see updated content
      mockWriteFileSync.mockImplementation((p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
        const s = p.toString();
        if (s.includes("settings.json")) {
          settingsContent = data as string;
        }
      });

      await teardown({ quiet: true });

      // Should have attempted to unlink the empty settings.json
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        path.join("/projects/myapp", ".claude", "settings.json"),
      );
    });
  });

  describe("skill file removal", () => {
    it("deletes skill file and cleans empty dirs", async () => {
      const skillPath = path.join(
        "/projects/myapp", ".claude", "skills", "review", "SKILL.md",
      );

      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === skillPath) return true;
        return false;
      });

      await teardown({ quiet: true });

      expect(mockUnlinkSync).toHaveBeenCalledWith(skillPath);
      // Should try to remove empty parent dirs
      expect(mockRmdirSync).toHaveBeenCalledWith(
        path.join("/projects/myapp", ".claude", "skills", "review"),
      );
      expect(mockRmdirSync).toHaveBeenCalledWith(
        path.join("/projects/myapp", ".claude", "skills"),
      );
    });

    it("skips when skill file does not exist", async () => {
      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining("SKILL.md"),
      );
    });
  });

  describe(".gitignore cleanup", () => {
    it("removes .diffprism line from .gitignore", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".gitignore")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".gitignore")) return "node_modules\n.diffprism\ndist\n";
        throw new Error("File not found");
      });

      await teardown({ quiet: true });

      const gitignoreWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".gitignore"),
      );
      expect(gitignoreWrite).toBeDefined();
      expect(gitignoreWrite![1]).toBe("node_modules\ndist\n");
    });

    it("deletes .gitignore when .diffprism was the only entry", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".gitignore")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".gitignore")) return ".diffprism\n";
        throw new Error("File not found");
      });

      await teardown({ quiet: true });

      expect(mockUnlinkSync).toHaveBeenCalledWith(
        path.join("/projects/myapp", ".gitignore"),
      );
    });

    it("skips when .gitignore does not exist", async () => {
      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining(".gitignore"),
      );
    });

    it("skips when .diffprism not in .gitignore", async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === path.join("/projects/myapp", ".gitignore")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith(".gitignore")) return "node_modules\ndist\n";
        throw new Error("File not found");
      });

      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining(".gitignore"),
      );
    });
  });

  describe(".diffprism directory removal", () => {
    it("removes .diffprism directory recursively", async () => {
      const dirPath = path.join("/projects/myapp", ".diffprism");

      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === path.join("/projects/myapp", ".git")) return true;
        if (s === dirPath) return true;
        return false;
      });

      await teardown({ quiet: true });

      expect(mockRmSync).toHaveBeenCalledWith(dirPath, { recursive: true });
    });

    it("skips when .diffprism directory does not exist", async () => {
      const result = await teardown({ quiet: true });

      expect(result.skipped).toContainEqual(
        expect.stringContaining(".diffprism"),
      );
    });
  });

  describe("global teardown", () => {
    it("does not require a git root", async () => {
      mockExistsSync.mockReturnValue(false);

      await teardown({ global: true });

      expect(process.exit).not.toHaveBeenCalled();
    });

    it("removes global skill and permissions only", async () => {
      const skillPath = path.join(
        "/home/testuser", ".claude", "skills", "review", "SKILL.md",
      );
      const settingsPath = path.join(
        "/home/testuser", ".claude", "settings.json",
      );

      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === skillPath) return true;
        if (s === settingsPath) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s === settingsPath) {
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

      const result = await teardown({ global: true, quiet: true });

      // Skill removed
      expect(mockUnlinkSync).toHaveBeenCalledWith(skillPath);

      // Permissions removed
      const settingsWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0].toString() === settingsPath,
      );
      expect(settingsWrite).toBeDefined();

      // No .mcp.json, .gitignore, or .diffprism touched
      expect(result.removed).not.toContainEqual(
        expect.stringContaining(".mcp.json"),
      );
      expect(result.removed).not.toContainEqual(
        expect.stringContaining(".gitignore"),
      );
    });

    it("prints global-specific message", async () => {
      mockExistsSync.mockReturnValue(false);

      await teardown({ global: true });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("global"),
      );
    });
  });

  describe("summary output", () => {
    it("prints removed and skipped items", async () => {
      await teardown({});

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Skipped"),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("DiffPrism configuration removed"),
      );
    });

    it("suppresses output with --quiet", async () => {
      await teardown({ quiet: true });

      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
